/*
 * Shelf Tools - Sync: one Memory Stick and the vault, compared and brought level.
 *
 * The vault is a folder on the computer that holds the newest of everything. Each PSP or
 * PS Vita is synced with the vault, never with another device, so what one device adds
 * reaches the others the next time each of them is synced.
 *
 *   scan(dir, role)      reads what Sync cares about from the Memory Stick or the vault
 *   plan(stick, vault)   decides, without writing anything, what each side is missing
 *   apply(plan, ...)     does the parts of the plan that are switched on
 *
 * What is synced, and how two sides become one:
 *   game saves           PSP/SAVEDATA/<save>/   whole folder; the side that changed since the last sync wins
 *   achievements         EMBLEM/earned/<id>.txt joined; an achievement on both keeps its first date
 *   Emblem game files    EMBLEM/games/<id>.txt  as saves
 *   journey, time played CHECKPOINT/JOURNEY/    lines joined; play on each device since the last sync is added up
 *   Shelf's marks        SHELF/games.txt        favourite, completed, hidden, last started (by disc ID)
 *   Runtime's logs       RUNTIME/               copied to the vault only: they describe one device's battery
 * Sidequest's states are left alone: a state only loads on the device that made it.
 *
 * "Since the last sync" is known from SYNC/STATE.JSON on the Memory Stick: what it and
 * the vault agreed on. Nothing is ever deleted on either side. A save that is replaced
 * is first kept in the vault under SYNC/history.
 */
(function (root) {
  "use strict";

  const FORMAT = 1;
  const SAVE_RE = /^[A-Z]{4}\d{5}[A-Za-z0-9_-]*$/i;       // disc ID first: game saves, not ARK's own folder
  const BIG = 32 * 1024 * 1024;                            // a "save" larger than this is installed game data
  const KEEP = 5;                                          // replaced copies kept per save
  const RUNTIME_FILES = ["RUNTIME/battery.log", "RUNTIME/battery_use.log", "RUNTIME/uptime.txt", "SHELF/battery.log"];

  const subtle = (typeof crypto !== "undefined" && crypto.subtle) || (typeof require !== "undefined" ? require("crypto").webcrypto.subtle : null);
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  async function sha(bytes) {
    if (typeof bytes === "string") bytes = new TextEncoder().encode(bytes);
    return hex(await subtle.digest("SHA-256", bytes)).slice(0, 32);
  }
  // One value for a folder of files: the same files with the same contents give the same value.
  async function fingerprint(files) {
    const l = files.map((f) => `${f.path.toUpperCase()}\t${f.size}\t${f.hash}\n`).sort();
    return sha(l.join(""));
  }
  function utf8(bytes) {          // null when the bytes are not text Sync can safely rewrite
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch (e) { return null; }
  }
  const up = (s) => String(s).toUpperCase();
  const u32 = (b, at) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
  const cstr = (b, at, len) => { let e = at; while (e < at + len && e < b.length && b[e]) e++; return new TextDecoder("utf-8").decode(b.subarray(at, e)); };
  const pad = (n, w) => String(n).padStart(w || 2, "0");
  const stampOf = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const clockOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

  // ---- PARAM.SFO: the game's name and how it describes the save ---------------------------
  function sfoRead(b) {
    const out = {};
    if (!b || b.length < 20 || u32(b, 0) !== 0x46535000) return out;
    const keys = u32(b, 8), data = u32(b, 12), n = u32(b, 16);
    for (let i = 0; i < n && 20 + (i + 1) * 16 <= b.length; i++) {
      const at = 20 + i * 16;
      const k = cstr(b, keys + (b[at] | (b[at + 1] << 8)), 64), fmt = b[at + 2] | (b[at + 3] << 8), len = u32(b, at + 4), off = data + u32(b, at + 12);
      if (off + len > b.length) continue;
      out[k] = fmt === 0x0404 ? u32(b, off) : cstr(b, off, len);
    }
    return out;
  }
  function sfoWrite(fields) {          // text fields only; for the sample and the tests
    const enc = new TextEncoder(), ks = Object.keys(fields).sort();
    const kb = ks.map((k) => enc.encode(k + "\0")), vb = ks.map((k) => { const v = enc.encode(fields[k] + "\0"); const p = new Uint8Array((v.length + 3) & ~3); p.set(v); return [v.length, p]; });
    const keysAt = 20 + ks.length * 16, klen = kb.reduce((s, k) => s + k.length, 0), dataAt = (keysAt + klen + 3) & ~3;
    const out = new Uint8Array(dataAt + vb.reduce((s, v) => s + v[1].length, 0)), dv = new DataView(out.buffer);
    dv.setUint32(0, 0x46535000, true); dv.setUint32(4, 0x0101, true); dv.setUint32(8, keysAt, true); dv.setUint32(12, dataAt, true); dv.setUint32(16, ks.length, true);
    let ko = 0, vo = 0;
    ks.forEach((k, i) => {
      const at = 20 + i * 16;
      dv.setUint16(at, ko, true); dv.setUint16(at + 2, 0x0204, true); dv.setUint32(at + 4, vb[i][0], true); dv.setUint32(at + 8, vb[i][1].length, true); dv.setUint32(at + 12, vo, true);
      out.set(kb[i], keysAt + ko); out.set(vb[i][1], dataAt + vo);
      ko += kb[i].length; vo += vb[i][1].length;
    });
    return out;
  }

  // ---- reading one side --------------------------------------------------------------------
  async function scanFolder(dir, path, name) {
    const files = await dir.walk(path);
    const size = files.reduce((s, f) => s + f.size, 0);
    if (!files.length) return null;
    if (size > BIG) return { name, key: up(name), size, big: true };
    let sfo = {}, icon = null, time = 0;
    for (const f of files) {
      const b = await dir.read(path + "/" + f.path);
      f.hash = await sha(b);
      f.size = b.length;
      if (/^PARAM\.SFO$/i.test(f.path)) sfo = sfoRead(b);
      if (/^ICON0\.PNG$/i.test(f.path)) icon = path + "/" + f.path;
      if (f.mtime > time) time = f.mtime;
    }
    return { name, key: up(name), path, files, size, time, fp: await fingerprint(files), sfo, icon };
  }

  async function scan(dir, role, progress) {
    const say = progress || (() => {});
    if (dir.fresh) dir.fresh();
    const top = (await dir.list("")) || [];
    const has = (n) => top.some((e) => e.dir && up(e.name) === n);
    const snap = {
      role, label: dir.label, state: null, top: top.map((e) => e.name),
      has: { psp: has("PSP"), sidequest: has("SIDEQUEST"), checkpoint: has("CHECKPOINT"), emblem: has("EMBLEM"), runtime: has("RUNTIME"), shelf: has("SHELF"), iso: has("ISO"), sync: has("SYNC") },
      saves: new Map(), big: [], unread: new Set(), earned: new Map(), egames: new Map(), journey: new Map(), marks: null, library: [],
      runtime: [], slots: new Map(), titles: new Map(), history: new Map(), devices: new Map(), wrongRole: false, notes: [],
    };
    const json = async (p) => { try { const t = await dir.text(p); return t ? JSON.parse(t) : null; } catch (e) { snap.notes.push(`${p} could not be read and is not used`); return null; } };
    snap.state = await json(role === "vault" ? "SYNC/VAULT.JSON" : "SYNC/STATE.JSON");
    if (snap.state && snap.state.format > FORMAT) throw new Error(`${dir.label || "That folder"} was written by a newer Shelf Tools. Reload the page to get it.`);
    snap.wrongRole = !!(await dir.stat(role === "vault" ? "SYNC/STATE.JSON" : "SYNC/VAULT.JSON"));

    // game saves
    const sd = ((await dir.list("PSP/SAVEDATA")) || []).filter((e) => e.dir && SAVE_RE.test(e.name));
    for (let i = 0; i < sd.length; i++) {
      say("Reading saves", i, sd.length, sd[i].name);
      try {
        const s = await scanFolder(dir, "PSP/SAVEDATA/" + sd[i].name, sd[i].name);
        if (!s) continue;
        if (s.big) { snap.big.push(s); snap.unread.add(s.key); continue; }
        snap.saves.set(s.key, s);
        if (s.sfo.TITLE && !snap.titles.has(s.key.slice(0, 9))) snap.titles.set(s.key.slice(0, 9), s.sfo.TITLE);
      } catch (e) { snap.unread.add(up(sd[i].name)); snap.notes.push(`PSP/SAVEDATA/${sd[i].name} could not be read and is left alone: ${e && e.message || e}`); }
    }
    say("Reading plugin files", 0, 1, "");

    // Emblem
    for (const e of (await dir.list("EMBLEM/earned")) || []) {
      const m = /^(.+)\.txt$/i.exec(e.name);
      if (e.dir || !m) continue;
      const b = await dir.read("EMBLEM/earned/" + e.name);
      snap.earned.set(up(m[1]), { name: e.name, text: utf8(b) });
      const h = /earned in (.+) \(([^)]+)\), kept by Emblem/.exec(utf8(b.subarray(0, 200)) || "");
      if (h) snap.titles.set(up(m[1]), h[1]);
    }
    for (const e of (await dir.list("EMBLEM/games")) || []) {
      const m = /^(.+)\.txt$/i.exec(e.name);
      if (e.dir || !m) continue;
      const b = await dir.read("EMBLEM/games/" + e.name), st = await dir.stat("EMBLEM/games/" + e.name);
      snap.egames.set(up(m[1]), { name: e.name, key: up(m[1]), size: b.length, time: st ? st.mtime : 0, fp: await sha(b) });
    }

    // Checkpoint's journey and time played
    for (const e of (await dir.list("CHECKPOINT/JOURNEY")) || []) {
      const m = /^(.+)\.(TXT|TIM|NEW)$/i.exec(e.name);
      if (e.dir || !m) continue;
      const k = up(m[1]), kind = up(m[2]);
      const j = snap.journey.get(k) || { game: m[1], txt: null, txtName: null, tim: null, timName: null, bad: false, spare: null };
      const b = await dir.read("CHECKPOINT/JOURNEY/" + e.name);
      if (kind === "TXT") { j.txt = utf8(b); j.txtName = e.name; if (j.txt === null) j.bad = true; }
      else {
        const v = /^\s*(\d+)/.exec(utf8(b.subarray(0, 16)) || "");
        if (kind === "TIM") { j.timName = e.name; if (v) j.tim = +v[1]; } else if (v) j.spare = +v[1];
      }
      snap.journey.set(k, j);
    }
    for (const j of snap.journey.values()) if (j.tim === null && j.spare !== null) j.tim = j.spare;   // Checkpoint's own rule for a cut-short write

    // Shelf: the library ties a path to a disc ID; games.txt holds the marks
    try {
      const lib = await dir.read("SHELF/CACHE/LIBRARY.BIN");
      if (lib && lib.length >= 16 && u32(lib, 0) === 0x42494c53) {
        const entry = u32(lib, 8), n = u32(lib, 12);
        for (let i = 0; i < n && 16 + (i + 1) * entry <= lib.length; i++) {
          const at = 16 + i * entry;
          const path = cstr(lib, at, 192), title = cstr(lib, at + 192, 96) || cstr(lib, at + 288, 96), id = up(cstr(lib, at + 384, 16).replace("-", ""));
          if (lib[at + 400] === 255 || !path) continue;
          snap.library.push({ path, title, id, iconKey: lib[at + 401] ? u32(lib, at + 416) : null });
          if (id && title) snap.titles.set(id, title);
        }
      }
    } catch (e) { snap.notes.push("Shelf's library could not be read; its marks are left alone"); }
    const gt = await dir.read("SHELF/games.txt");
    if (gt) { snap.marks = { text: utf8(gt), name: "SHELF/games.txt" }; if (snap.marks.text === null) snap.marks = null; }

    if (role === "stick") {
      for (const p of RUNTIME_FILES) {
        const b = await dir.read(p);
        if (b) snap.runtime.push({ path: p, size: b.length, hash: await sha(b) });
      }
      // Sidequest: only to warn that a suspend is older than a save about to arrive
      for (const d of (await dir.list("SIDEQUEST")) || []) {
        if (!d.dir) continue;
        for (const e of (await dir.list("SIDEQUEST/" + d.name)) || []) {
          if (e.dir || !/^(SUSPEND|STATE[1-5])\.SQS$/i.test(e.name)) continue;
          try {
            const h = await dir.read(`SIDEQUEST/${d.name}/${e.name}`, 0, 404);
            if (!h || h.length < 404 || u32(h, 0) !== 0x31535153) continue;
            const id = up(cstr(h, 228, 16).replace("-", "")), when = cstr(h, 244, 32).slice(0, 16);
            const was = snap.slots.get(id);
            if (id && (!was || when > was.when)) snap.slots.set(id, { when, suspend: /^SUSPEND/i.test(e.name) });
          } catch (x) { /* a slot that cannot be read only loses its warning */ }
        }
      }
    } else {
      for (const d of (await dir.list("SYNC/history")) || []) if (d.dir) snap.history.set(up(d.name), ((await dir.list("SYNC/history/" + d.name)) || []).filter((e) => e.dir).map((e) => e.name).sort());
      for (const d of (await dir.list("SYNC/devices")) || []) {
        if (!d.dir) continue;
        const m = new Map();
        for (const f of await dir.walk("SYNC/devices/" + d.name)) m.set(up(f.path), await sha(await dir.read(`SYNC/devices/${d.name}/${f.path}`)));
        snap.devices.set(d.name, m);
      }
    }
    return snap;
  }

  // ---- achievements --------------------------------------------------------------------------
  function earnedRead(text) {
    const out = { header: null, byN: new Map() };
    for (const l of (text || "").split(/\r?\n/)) {
      if (l[0] === "#") { if (!out.header) out.header = l; continue; }
      const m = /^(\d{1,4})\s*\|(.*)$/.exec(l);
      if (!m || +m[1] < 1 || +m[1] > 255 || out.byN.has(+m[1])) continue;        // twice in a file: the first one stands, as in Emblem
      const date = /^\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/.exec(m[2]);
      out.byN.set(+m[1], { n: +m[1], date: date ? date[1] : "", raw: l.replace(/\s+$/, "") });
    }
    return out;
  }
  function earnedMerge(sText, vText) {
    const s = earnedRead(sText), v = earnedRead(vText), all = new Map();
    for (const side of [v, s]) for (const e of side.byN.values()) {
      const was = all.get(e.n);
      if (!was || (e.date && (!was.date || e.date < was.date))) all.set(e.n, e);     // on both: the first date
    }
    const list = [...all.values()].sort((a, b) => (a.date || "9") < (b.date || "9") ? -1 : (a.date || "9") > (b.date || "9") ? 1 : a.n - b.n);
    const same = (side) => side.byN.size === all.size && list.every((e) => (side.byN.get(e.n) || {}).date === e.date);
    const text = (header) => (header ? header + "\r\n" : "") + list.map((e) => e.raw + "\r\n").join("");
    return {
      count: list.length, sameS: sText != null && same(s), sameV: vText != null && same(v),
      addS: list.filter((e) => !s.byN.has(e.n)).length, addV: list.filter((e) => !v.byN.has(e.n)).length,
      textS: text(s.header || v.header), textV: text(v.header || s.header),
    };
  }

  // ---- journey and time played ---------------------------------------------------------------
  function journeyRead(text) {
    const out = { header: null, other: [], list: [], keys: new Map() };
    for (const l0 of (text || "").split(/\r?\n/)) {
      const l = l0.replace(/\s+$/, "");
      if (!l) continue;
      if (l[0] === "#") { if (!out.header) out.header = l; else out.other.push(l); continue; }
      const f = l.split(" | "), t = /^\s*(\d+)h\s*(\d+)m\s*$/.exec(f[1] || "");
      if (f.length < 4 || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(f[0]) || !t || !f[2].trim()) { out.other.push(l); continue; }
      const e = { stamp: f[0].slice(0, 16), mins: +t[1] * 60 + +t[2], text: f[2].trim(), save: f.slice(3).join(" | ").trim() };
      e.key = `${e.stamp}|${e.text}|${e.save}`;
      if (out.keys.has(e.key)) continue;
      out.keys.set(e.key, e); out.list.push(e);
    }
    return out;
  }
  const journeyLine = (e, mins) => `${e.stamp} | ${Math.floor(mins / 60)}h ${pad(mins % 60)}m | ${e.text} | ${e.save}`;
  // s, v: { txt, tim } of each side (null when it has none). at: where the two stood when
  // this device was last synced, { s: the device's seconds then, v: the vault's }, or null
  // when it never was. Play on the device since then is what it adds to the vault's total.
  function journeyMerge(game, s, v, at) {
    const S = journeyRead(s && s.txt), V = journeyRead(v && v.txt);
    const last = (J) => J.list.reduce((m, e) => Math.max(m, e.mins * 60), 0);
    const sT = s && s.tim != null ? s.tim : last(S), vT = v && v.tim != null ? v.tim : last(V);
    const sig = (J) => J.list.map((e) => e.key + "|" + e.mins).join("\n");
    let bs, bv;
    if (at) { bs = at.s; bv = at.v; }
    else {
      // No last sync to go by. Lines both sides hold, with the same total, are shared
      // history: play up to the last of them is counted once. Two sides that are the
      // same in everything are one history, not two to add up.
      let b = 0;
      if (sT === vT && sig(S) === sig(V)) b = sT;
      else for (const e of S.list) { const o = V.keys.get(e.key); if (o && o.mins === e.mins) b = Math.max(b, e.mins * 60); }
      bs = bv = Math.min(b, sT, vT);
    }
    const ds = Math.max(0, sT - bs), tim = Math.max(vT, bv) + ds;
    // What each side logged that the other has not: how much play each line added on its own side
    const fresh = (J, O, from, start) => {
      let prev = start;
      return J.list.filter((e) => !O.keys.has(e.key)).map((e, i) => {
        const add = Math.max(0, e.mins * 60 - prev);
        prev = Math.max(prev, e.mins * 60);
        return { e, add, from, i };
      });
    };
    const ns = fresh(S, V, 0, bs), nv = fresh(V, S, 1, bv);
    const news = [...ns, ...nv].sort((a, c) => (a.e.stamp < c.e.stamp ? -1 : a.e.stamp > c.e.stamp ? 1 : a.from - c.from || a.i - c.i));
    let run = bv;
    const out = [];
    for (const e of V.list) if (S.keys.has(e.key)) out.push({ stamp: e.stamp, mins: Math.max(e.mins, S.keys.get(e.key).mins), e, n: out.length });
    for (const x of news) { run += x.add; out.push({ stamp: x.e.stamp, mins: Math.floor(Math.min(run, tim) / 60), e: x.e, n: out.length }); }
    out.sort((a, c) => (a.stamp < c.stamp ? -1 : a.stamp > c.stamp ? 1 : a.n - c.n));
    const merged = out.map((x) => x.e.key + "|" + x.mins).join("\n");
    const header = (J, O) => J.header || O.header || `# Journey log of ${game}, kept by Checkpoint: date | time played | description | save`;
    const text = (J, O) => [header(J, O), ...new Set([...J.other, ...O.other]), ...out.map((x) => journeyLine(x.e, x.mins))].map((l) => l + "\r\n").join("");
    const lines = out.length > 0;
    return {
      tim, sT, vT, lines: out.length,
      addS: nv.length, addV: ns.length, gainS: tim - sT, gainV: tim - vT,
      txtS: lines && sig(S) !== merged ? text(S, V) : null, txtV: lines && sig(V) !== merged ? text(V, S) : null,
      timS: !s || s.tim !== tim, timV: !v || (v.file === undefined ? v.tim : v.file) !== tim,
    };
  }

  // ---- Shelf's marks --------------------------------------------------------------------------
  function marksRead(text) {
    const out = [];
    for (const l of (text || "").split(/\r?\n/)) {
      if (!l.trim()) continue;
      const f = l.split("|").map((x) => x.trim());
      if (l[0] === "#" || f.length < 5 || !f[0]) { out.push({ raw: l.replace(/\s+$/, "") }); continue; }
      out.push({ path: f[0], launched: +f[1] || 0, finished: +f[2] || 0, hidden: +f[3] ? 1 : 0, pic: parseInt(f[4], 10) || 0, fav: f.length >= 6 && +f[5] ? 1 : 0 });
    }
    return out;
  }
  const marksLine = (m) => `${m.path} | ${m.launched} | ${m.finished} | ${m.hidden} | ${m.pic} | ${m.fav}`;
  // One value from this device (s), the vault (v) and what they agreed on last time (b)
  const three = (s, v, b, first) => (v === undefined ? s : b === undefined ? first(s, v) : s !== b ? s : v);
  function marksMerge(S, vmarks, bmarks) {
    const lines = marksRead(S.marks ? S.marks.text : ""), byPath = new Map();
    for (const l of lines) if (l.path) byPath.set(up(l.path), l);
    const games = new Map();                     // disc ID -> the paths on this device
    for (const g of S.library) if (g.id) { if (!games.has(g.id)) games.set(g.id, []); games.get(g.id).push(g); }
    const changes = [], vault = {}, base = {};
    let touched = false;
    for (const [id, gs] of games) {
      const mine = gs.map((g) => byPath.get(up(g.path))).filter(Boolean);
      const s = { launched: Math.max(0, ...mine.map((l) => l.launched)), finished: Math.max(0, ...mine.map((l) => l.finished)),
                  hidden: mine.some((l) => l.hidden) ? 1 : 0, fav: mine.some((l) => l.fav) ? 1 : 0 };
      const v = vmarks[id], b = bmarks[id] || {};
      if (!v && !mine.length) continue;
      const m = {
        launched: Math.max(s.launched, (v && v.launched) || 0),
        finished: three(s.finished, v && v.finished, b.finished, (x, y) => (x && y ? Math.min(x, y) : x || y)),
        hidden: three(s.hidden, v && v.hidden, b.hidden, (x, y) => x || y),
        fav: three(s.fav, v && v.fav, b.fav, (x, y) => x || y),
      };
      const what = [];
      const diff = (a) => a.launched !== m.launched || a.finished !== m.finished || a.hidden !== m.hidden || a.fav !== m.fav;
      if (diff(s) && (mine.length || m.launched || m.finished || m.hidden || m.fav)) {
        if (s.fav !== m.fav) what.push(m.fav ? "favourite" : "no longer a favourite");
        if (!!s.finished !== !!m.finished) what.push(m.finished ? "completed" : "not completed");
        if (s.hidden !== m.hidden) what.push(m.hidden ? "hidden from Home" : "back on Home");
        if (s.launched !== m.launched) what.push("last started");
        for (const g of gs) {
          let l = byPath.get(up(g.path));
          if (!l) { l = { path: g.path, launched: 0, finished: 0, hidden: 0, pic: -1, fav: 0 }; lines.push(l); byPath.set(up(g.path), l); }
          Object.assign(l, m);
        }
        touched = true;
        changes.push({ id, title: gs[0].title || id, to: "stick", what });
      }
      if (!v || diff(v)) {
        const w = [];
        if (!v || v.fav !== m.fav) { if (m.fav || v) w.push(m.fav ? "favourite" : "no longer a favourite"); }
        if (!v ? m.finished : !!v.finished !== !!m.finished) w.push(m.finished ? "completed" : "not completed");
        if (!v ? m.hidden : v.hidden !== m.hidden) w.push(m.hidden ? "hidden from Home" : "back on Home");
        if ((v ? v.launched : 0) !== m.launched) w.push("last started");
        changes.push({ id, title: gs[0].title || id, to: "vault", what: w });
        vault[id] = Object.assign({ title: gs[0].title || "" }, m);
      }
      base[id] = { finished: m.finished, hidden: m.hidden, fav: m.fav };
    }
    const header = "# Shelf: path | last started | finished | hidden | picture | favourite (times in minutes since 2000)";
    const text = touched ? (lines.some((l) => l.raw && l.raw[0] === "#") ? "" : header + "\r\n") + lines.map((l) => (l.path ? marksLine(l) : l.raw) + "\r\n").join("") : null;
    return { changes, text, vault, base };
  }

  // ---- the plan ---------------------------------------------------------------------------------
  function plan(S, V, opts) {
    opts = opts || {};
    const P = { items: [], errors: [], warnings: [], notes: [...S.notes, ...V.notes], same: { save: 0, emblem: 0, earned: 0, journey: 0 },
                base: { saves: {}, emblem: {}, marks: {} }, S, V, firstSync: !S.state, newVault: !V.state, baseOk: false, device: (S.state && S.state.device) || null };
    const stickish = S.has.psp || S.has.sidequest || S.has.checkpoint || S.has.emblem || S.has.runtime || S.has.shelf;
    if (S.wrongRole) P.errors.push("The folder picked as the Memory Stick is a vault. Pick the Memory Stick's drive there, or a PS Vita's pspemu folder.");
    else if (!stickish) P.errors.push("No PSP, SIDEQUEST, CHECKPOINT, EMBLEM, RUNTIME or SHELF folder was found on the Memory Stick that was picked. Pick the drive itself; on a PS Vita, the pspemu folder.");
    if (V.wrongRole || V.has.iso || V.has.sidequest || V.has.shelf || V.has.runtime) P.errors.push("The folder picked as the vault is a Memory Stick. The vault is a folder of its own on the computer.");
    else if (!V.state && V.top.some((n) => !/^(PSP|EMBLEM|CHECKPOINT|SYNC)$/i.test(n))) P.errors.push("The folder picked as the vault has other files in it. For a new vault, make an empty folder and pick that.");
    if (P.errors.length) return P;

    P.baseOk = !!(S.state && V.state && S.state.vault === V.state.id);
    if (S.state && V.state && !P.baseOk) P.warnings.push("This Memory Stick was last synced with a different vault. Saves that differ are shown for you to choose, and play time is added up as on a first sync.");
    if (S.state && !V.state) P.warnings.push("This vault is new, but the Memory Stick has been synced before, with another vault.");
    const bs = P.baseOk ? S.state : { saves: {}, emblem: {}, marks: {} };
    const vx = V.state || { saves: {}, emblem: {}, marks: {}, devices: {}, tim: {} };
    const title = (id) => S.titles.get(id) || V.titles.get(id) || (vx.marks && vx.marks[id] && vx.marks[id].title) || id;
    const from = (rec) => (rec && rec.from && vx.devices && vx.devices[rec.from] ? vx.devices[rec.from].name : "");
    const add = (it) => { it.n = P.items.length; it.on = it.on !== false; P.items.push(it); return it; };

    // a device gets plugin files only when it has that plugin's folder, or Shelf to show them
    const emblemHere = S.has.emblem || S.has.shelf, checkpointHere = S.has.checkpoint || S.has.shelf;
    const cut = new Set(P.baseOk && S.state.pending ? S.state.pending : []);
    // saves and Emblem game files: the side that changed since the last sync wins
    const folders = (kind, sm, vm, base, index) => {
      for (const key of [...new Set([...sm.keys(), ...vm.keys()])].sort()) {
        const s = sm.get(key) || null, v = vm.get(key) || null, b = base ? base[key] : undefined, rec = index ? index[key] : null;
        // A folder that is there but was not read (too large, or unreadable) is not "missing":
        // nothing is copied over it from the other side.
        if (kind === "save" && (S.unread.has(key) || V.unread.has(key))) continue;
        const game = kind === "save" ? key.slice(0, 9) : key;
        const it = { kind, key, game, title: title(game), name: (s || v).name, s, v, timeS: s ? s.time : 0, timeV: (rec && rec.time) || 0, fromV: from(rec) };
        if (s && v && s.fp === v.fp) { P.same[kind]++; P.base[kind === "save" ? "saves" : "emblem"][key] = s.fp; continue; }
        if (!s && kind === "emblem" && !emblemHere) continue;         // no Emblem and no Shelf on this device: nothing to give it
        if (s && !v) it.action = "toVault", it.why = "new";
        else if (!s && v) {
          if (b !== undefined) { it.action = "gone"; it.on = false; }        // it was here at the last sync and has been removed since
          else it.action = "toStick", it.why = "new";
        } else if (b !== undefined && b === v.fp) it.action = "toVault", it.why = "changed";
        else if (b !== undefined && b === s.fp) it.action = "toStick", it.why = "changed";
        else { it.action = "conflict"; it.choice = it.timeS >= it.timeV ? "stick" : "vault"; }
        // The last sync was cut short while this save was being copied to the device:
        // what is there now may be half of each, so the vault's copy is the one to take.
        if (kind === "save" && cut.has(key) && s && v) { it.action = "conflict"; it.choice = "vault"; it.cut = true; }
        if (kind === "save") {
          const slot = S.slots.get(game);
          if (slot && (it.action === "toStick" || it.action === "conflict") && s) it.slot = slot;
        }
        add(it);
      }
    };
    folders("save", S.saves, V.saves, bs.saves, vx.saves);
    folders("emblem", S.egames, V.egames, bs.emblem, vx.emblem);
    for (const b of S.big) P.notes.push(`PSP/SAVEDATA/${b.name} is ${Math.round(b.size / 1048576)} MB, more than a save: it is left alone`);

    // achievements
    for (const id of [...new Set([...S.earned.keys(), ...V.earned.keys()])].sort()) {
      const s = S.earned.get(id), v = V.earned.get(id);
      if ((s && s.text === null) || (v && v.text === null)) { P.notes.push(`EMBLEM/earned/${id}.txt is not plain text on one side and is left alone`); continue; }
      const m = earnedMerge(s ? s.text : null, v ? v.text : null);
      const toS = !m.sameS && emblemHere, toV = !m.sameV;
      if (!toS && !toV) { P.same.earned++; continue; }
      add({ kind: "earned", key: id, game: id, title: title(id), nameS: s ? s.name : id + ".txt", nameV: v ? v.name : id + ".txt", m, toS, toV });
    }

    // journey and time played. The vault's total is the one in VAULT.JSON, written in one
    // piece with where each device stood; the .TIM file beside the journey is a copy of it.
    P.times = [];
    for (const g of [...new Set([...S.journey.keys(), ...V.journey.keys()])].sort()) {
      const s = S.journey.get(g) || null, vf = V.journey.get(g) || null, rec = vx.tim && vx.tim[g];
      if ((s && s.bad) || (vf && vf.bad)) { P.notes.push(`CHECKPOINT/JOURNEY/${g}.TXT is not plain text on one side and is left alone`); continue; }
      const v = vf || rec ? Object.assign({ game: g, txt: null, txtName: null, timName: null }, vf, { file: vf ? vf.tim : null, tim: rec ? rec.total : vf.tim }) : null;
      let at = P.baseOk && P.device && rec && rec.at ? rec.at[P.device.id] : null;
      if (at && at.to !== undefined) {
        // the last sync stopped before it was known whether the device's file was written
        const here = s && s.tim != null ? s.tim : 0;
        at = here >= at.to ? { s: at.to, v: at.to } : { s: at.from, v: at.to };
      }
      const m = journeyMerge((s || v).game, s, v, at || null);
      const it = { kind: "journey", key: g, game: g.slice(0, 9), title: title(g.slice(0, 9)), s, v, m,
                   toS: checkpointHere && (m.txtS !== null || m.timS), toV: m.txtV !== null || m.timV };
      if (it.toS || it.toV) add(it);
      else { P.same.journey++; P.times.push(it); }        // level: only where the two stand is noted
    }

    // Shelf's marks
    if (S.has.shelf && S.library.length) {
      const m = marksMerge(S, vx.marks || {}, bs.marks || {});
      P.marks = m;
      if (m.changes.length) add({ kind: "marks", key: "marks", game: "", title: "Shelf", m });
      else P.base.marks = m.base;
    }

    // Runtime's logs: kept per device in the vault
    const dev = P.device ? V.devices.get(P.device.id) || V.devices.get(up(P.device.id)) : null;
    const todo = S.runtime.filter((f) => !dev || dev.get(up(f.path)) !== f.hash);
    if (todo.length) add({ kind: "runtime", key: "runtime", game: "", title: "Runtime", files: todo });
    return P;
  }

  // ---- doing it ---------------------------------------------------------------------------------
  // Copies a folder of files. Every byte read is checked against what Compare saw, and
  // what was written is read back before the copy counts.
  async function copyFolder(from, src, to, toPath) {
    // everything is read before anything is written: a Memory Stick pulled out while
    // it is being read leaves the other side as it was
    const data = [];
    for (const f of src.files) {
      const b = await from.read(src.path + "/" + f.path);
      if (!b || (await sha(b)) !== f.hash) throw new Error(`${src.name}/${f.path} changed after Compare. Compare again.`);
      data.push(b);
    }
    for (let i = 0; i < data.length; i++) await to.write(toPath + "/" + src.files[i].path, data[i]);
    const keep = new Set(src.files.map((f) => up(f.path)));
    for (const f of await to.walk(toPath)) if (!keep.has(up(f.path))) await to.remove(toPath + "/" + f.path);
    const back = await scanFolder(to, toPath, src.name);
    if (!back || back.fp !== src.fp) throw new Error(`${src.name} did not read back as it was written`);
    return back;
  }

  async function apply(P, Sdir, Vdir, opts) {
    opts = opts || {};
    const now = opts.now ? new Date(opts.now) : new Date(), say = opts.progress || (() => {});
    const S = P.S, V = P.V, res = { done: [], failed: [], skipped: 0, counts: {}, device: null };
    if (P.errors.length) throw new Error(P.errors[0]);
    const rnd = () => hex((typeof crypto !== "undefined" ? crypto : require("crypto").webcrypto).getRandomValues(new Uint8Array(4)));
    const ix = V.state ? JSON.parse(JSON.stringify(V.state)) : { format: FORMAT, id: opts.vaultId || rnd() + rnd(), created: now.toISOString() };
    for (const k of ["devices", "saves", "emblem", "marks", "tim"]) ix[k] = ix[k] || {};
    const dev = P.device ? Object.assign({}, P.device) : { id: opts.deviceId || rnd(), name: "" };
    if (opts.deviceName) dev.name = opts.deviceName;
    if (!dev.name) dev.name = "PSP";
    res.device = dev;
    const old = P.baseOk ? S.state : {};
    const st = { format: FORMAT, device: dev, vault: ix.id, synced: now.toISOString(),
                 saves: Object.assign({}, old.saves, P.base.saves), emblem: Object.assign({}, old.emblem, P.base.emblem), marks: Object.assign({}, old.marks, P.base.marks) };
    const count = (k) => { res.counts[k] = (res.counts[k] || 0) + 1; };
    const stamp = stampOf(now);
    const todo = P.items.filter((it) => it.on && dirOf(it) !== "skip");
    res.skipped = P.items.length - todo.length;

    // 1. The device is given its name, the vault's, and the saves on it that are about to
    //    be replaced. If the sync is cut short, the next Compare knows not to trust those.
    //    A Memory Stick that cannot be written stops the sync here, with nothing changed.
    const incoming = todo.filter((it) => it.kind === "save" && dirOf(it) === "toStick" && it.s).map((it) => it.key);
    const first = { format: FORMAT, device: dev, vault: ix.id, synced: old.synced || "", saves: old.saves || {}, emblem: old.emblem || {}, marks: old.marks || {} };
    if (incoming.length) first.pending = incoming;
    try { await Sdir.write("SYNC/STATE.JSON", JSON.stringify(first, null, 1)); }
    catch (e) { throw new Error("The Memory Stick cannot be written to, so nothing was changed. (" + (e && e.message || e) + ")"); }

    // 2. Play time. The vault takes in what each device played since its last sync, and
    //    notes where the device stood, in one write of VAULT.JSON: whatever happens after
    //    that, the same play is never added a second time.
    const stand = (g, at, total) => { ix.tim[g] = { total, at: Object.assign({}, ix.tim[g] && ix.tim[g].at, at ? { [dev.id]: at } : null) }; };
    for (const it of todo) if (it.kind === "journey") stand(it.key, it.toS ? { from: it.m.sT, to: it.m.tim } : it.s ? { s: it.m.tim, v: it.m.tim } : null, it.m.tim);
    for (const it of P.times || []) stand(it.key, it.s ? { s: it.m.tim, v: it.m.tim } : null, it.m.tim);
    await Vdir.write("SYNC/VAULT.JSON", JSON.stringify(ix, null, 1));

    // The copy that is about to be replaced goes to the vault's history first
    const keepOld = async (hkey, name, copy) => {
      const have = V.history.get(up(hkey)) || [];
      if (have.some((n) => n.endsWith("_" + name))) return;
      const dirName = `${stamp}_${name}`;
      await copy(`SYNC/history/${hkey}/${dirName}`);
      have.push(dirName); have.sort(); V.history.set(up(hkey), have);
      while (have.length > KEEP) await Vdir.removeDir(`SYNC/history/${hkey}/${have.shift()}`);
    };

    // 3. To the vault first: what a device holds is safe there before anything on the device is replaced
    const order = (it) => (it.kind === "runtime" ? 0 : dirOf(it) === "toVault" ? 1 : 2);
    todo.sort((a, b) => order(a) - order(b) || a.n - b.n);
    let i = 0;
    for (const it of todo) {
      say("Syncing", i++, todo.length, it.title || it.key);
      try {
        const d = dirOf(it);
        if (it.kind === "save") {
          const root = "PSP/SAVEDATA/";
          if (d === "toVault") {
            if (it.v) await keepOld(it.key, it.v.fp.slice(0, 8), (to) => copyFolder(Vdir, it.v, Vdir, to));
            await copyFolder(Sdir, it.s, Vdir, root + (it.v ? it.v.name : it.s.name));
            ix.saves[it.key] = { fp: it.s.fp, time: it.s.time, from: dev.id };
            st.saves[it.key] = it.s.fp; count("savesToVault");
          } else {
            if (it.s) await keepOld(it.key, it.s.fp.slice(0, 8), (to) => copyFolder(Sdir, it.s, Vdir, to));
            await copyFolder(Vdir, it.v, Sdir, root + (it.s ? it.s.name : it.v.name));
            st.saves[it.key] = it.v.fp; count("savesToStick");
          }
        } else if (it.kind === "emblem") {
          const root = "EMBLEM/games/", from = d === "toVault" ? Sdir : Vdir, to = d === "toVault" ? Vdir : Sdir;
          const src = d === "toVault" ? it.s : it.v, was = d === "toVault" ? it.v : it.s;
          const b = await from.read(root + src.name);
          if (!b || (await sha(b)) !== src.fp) throw new Error(`${src.name} changed after Compare. Compare again.`);
          if (was) await keepOld("EMBLEM_" + it.key, was.fp.slice(0, 8), async (h) => Vdir.write(h + "/" + was.name, await to.read(root + was.name)));
          const name = was ? was.name : src.name;
          await to.write(root + name, b);
          if ((await sha(await to.read(root + name))) !== src.fp) throw new Error(`${src.name} did not read back as it was written`);
          if (d === "toVault") { ix.emblem[it.key] = { fp: src.fp, time: src.time, from: dev.id }; count("emblemToVault"); } else count("emblemToStick");
          st.emblem[it.key] = src.fp;
        } else if (it.kind === "earned") {
          if (it.toV) await Vdir.write("EMBLEM/earned/" + it.nameV, it.m.textV);
          if (it.toS) await Sdir.write("EMBLEM/earned/" + it.nameS, it.m.textS);
          count("earned");
        } else if (it.kind === "journey") {
          const g = (it.s || it.v).game, m = it.m, at = "CHECKPOINT/JOURNEY/";
          if (m.txtV !== null) await Vdir.write(at + ((it.v && it.v.txtName) || g + ".TXT"), m.txtV);
          if (m.timV) await Vdir.write(at + ((it.v && it.v.timName) || g + ".TIM"), m.tim + "\n");
          if (it.toS) {
            if (m.txtS !== null) await Sdir.write(at + ((it.s && it.s.txtName) || g + ".TXT"), m.txtS);
            if (m.timS) await Sdir.write(at + ((it.s && it.s.timName) || g + ".TIM"), m.tim + "\n");
            stand(it.key, { s: m.tim, v: m.tim }, m.tim);            // the device now stands where the vault does
          }
          count("journey");
        } else if (it.kind === "marks") {
          if (it.m.text !== null) await Sdir.write("SHELF/games.txt", it.m.text);
          Object.assign(ix.marks, it.m.vault);
          Object.assign(st.marks, it.m.base); count("marks");
        } else if (it.kind === "runtime") {
          for (const f of it.files) {
            const b = await Sdir.read(f.path);
            if (b) await Vdir.write(`SYNC/devices/${dev.id}/${f.path}`, b);
          }
          count("runtime");
        }
        res.done.push(it);
      } catch (e) {
        it.error = e && e.message ? e.message : String(e);
        res.failed.push(it);
      }
    }

    // 4. Both sides are told how things stand now
    say("Finishing", todo.length, todo.length, "");
    const half = res.failed.filter((it) => it.kind === "save" && dirOf(it) === "toStick" && it.s).map((it) => it.key);
    if (half.length) st.pending = half;          // not trusted until a later sync copies them whole
    ix.devices[dev.id] = { name: dev.name, synced: now.toISOString(), kind: opts.deviceKind || (ix.devices[dev.id] || {}).kind || "",
                           saves: S.saves.size, games: new Set([...S.saves.keys()].map((k) => k.slice(0, 9))).size };
    const line = `${clockOf(now)}  ${dev.name}: ` + (summary(res.counts) || "nothing to do") + (res.failed.length ? `; ${res.failed.length} failed` : "");
    const log = ((await Vdir.text("SYNC/log.txt")) || "").split(/\r?\n/).filter(Boolean).slice(-499);
    if (!(await Vdir.exists("SYNC/README.txt"))) await Vdir.write("SYNC/README.txt", README);
    await Vdir.write("SYNC/log.txt", [...log, line].join("\r\n") + "\r\n");
    await Vdir.write("SYNC/VAULT.JSON", JSON.stringify(ix, null, 1));
    try { await Sdir.write("SYNC/STATE.JSON", JSON.stringify(st, null, 1)); }
    catch (e) { res.stateError = "The Memory Stick could not be written to at the end. Compare again once it is back: nothing is lost, but some saves may be asked about."; }
    res.line = line; res.state = st; res.index = ix;
    return res;
  }
  // which way an item goes, once a choice is made
  function dirOf(it) {
    if (it.action === "conflict") return it.choice === "vault" ? "toStick" : it.choice === "stick" ? "toVault" : "skip";
    if (it.action === "gone") return "toStick";
    if (it.kind === "save" || it.kind === "emblem") return it.action;
    if (it.kind === "runtime") return "toVault";
    return it.toS && it.toV ? "both" : it.toS ? "toStick" : "toVault";
  }
  function summary(c) {
    const n = (k, one, many) => (c[k] ? `${c[k]} ${c[k] === 1 ? one : many}` : "");
    return [n("savesToVault", "save to the vault", "saves to the vault"), n("savesToStick", "save to the device", "saves to the device"),
            n("earned", "game's achievements", "games' achievements"), n("journey", "game's journey and time", "games' journeys and times"),
            n("emblemToVault", "Emblem game file to the vault", "Emblem game files to the vault"), n("emblemToStick", "Emblem game file to the device", "Emblem game files to the device"),
            c.marks ? "Shelf's marks" : "", c.runtime ? "Runtime's logs" : ""].filter(Boolean).join(", ");
  }

  const README = [
    "This folder is a Shelf Tools vault: https://github.com/00KAM1/psp-shelf-tools",
    "",
    "It holds the newest copy of what Sync keeps level between your PSPs and PS Vitas:",
    "  PSP/SAVEDATA         game saves",
    "  EMBLEM               achievements earned, and Emblem's game files",
    "  CHECKPOINT/JOURNEY   journey logs and time played",
    "  SYNC/VAULT.JSON      what came from which device, and Shelf's marks",
    "  SYNC/history         the last " + KEEP + " copies of each save that Sync replaced, oldest removed first",
    "  SYNC/devices         each device's Runtime logs",
    "  SYNC/log.txt         one line per sync",
    "",
    "To put an old save back by hand, copy its files from SYNC/history/<save>/<date>_<code>/",
    "into PSP/SAVEDATA/<save>/ on the Memory Stick. Do not edit the other files here.",
    "",
  ].join("\r\n");

  const api = { scan, plan, apply, dirOf, summary, sha, fingerprint, sfoRead, sfoWrite, earnedRead, earnedMerge, journeyRead, journeyMerge, marksRead, marksMerge, SAVE_RE, BIG, KEEP, FORMAT };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SyncCore = api;
})(typeof window !== "undefined" ? window : globalThis);
