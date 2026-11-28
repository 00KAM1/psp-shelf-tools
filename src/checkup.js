/*
 * Shelf Tools - Checkup: is what is installed on this Memory Stick in order?
 *
 * It only reads. For each plugin and for Shelf it finds the installed file, reads the
 * name, version and build date written inside it, and compares the file's SHA-256 with
 * the files of the releases (data/official.json). Then it reads ARK's PLUGINS.TXT and
 * SETTINGS.TXT, each plugin's log and the headers of Sidequest's states, and says what
 * does not fit together.
 *
 *   run(stick, official, opts)  ->  { cards, counts, platform, found, text }
 *
 * A card is one thing that was looked at (a plugin, Shelf, ARK's settings, the states):
 *   { id, name, status, version, facts: [text], notes: [{ level, text, fix, code, link }] }
 * A note's level is "bad" (it will not work, or can break things), "warn" (worth changing) or "info".
 * Every rule here is taken from the plugins' and Shelf's own documentation and source.
 */
(function (root) {
  "use strict";

  const PLUGINS = [
    { id: "sidequest", name: "Sidequest", level: "game", log: "SIDEQUEST/sidequest.log" },
    { id: "checkpoint", name: "Checkpoint", level: "game", log: "CHECKPOINT/checkpoint.log" },
    { id: "emblem", name: "Emblem", level: "game", log: "EMBLEM/emblem.log" },
    { id: "scanline", name: "Scanline", level: "game", log: "SCANLINE/scanline.log" },
    { id: "runtime", name: "Runtime", level: "always", log: "RUNTIME/runtime.log" },
  ];
  const ARK = "PSP/SAVEDATA/ARK_01234/";
  const LISTS = ["SEPLUGINS/PLUGINS.TXT", ARK + "PLUGINS.TXT"];
  const REPO = {
    psp: { plugins: "https://github.com/00KAM1/psp-ark-plugins/releases", shelf: "https://github.com/00KAM1/psp-shelf-launcher/releases" },
    vita: { plugins: "https://github.com/00KAM1/psvita-ark-plugins/releases", shelf: "https://github.com/00KAM1/psvita-shelf-launcher/releases" },
  };
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const latin = (b) => new TextDecoder("latin1").decode(b);
  const u32 = (b, at) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
  const cstr = (b, at, len) => { let e = at; while (e < at + len && e < b.length && b[e]) e++; return latin(b.subarray(at, e)); };
  const vnum = (v) => String(v).split(".").map((x) => parseInt(x, 10) || 0);
  const newer = (a, b) => { const x = vnum(a), y = vnum(b); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  // "Nov 24 2026 13:28:58", the compiler's date, as a time
  function builtTime(s) {
    const m = /^([A-Z][a-z]{2}) +(\d+) (\d{4}) (\d\d):(\d\d):(\d\d)$/.exec(s || "");
    return m && MONTHS.includes(m[1]) ? new Date(+m[3], MONTHS.indexOf(m[1]), +m[2], +m[4], +m[5], +m[6]).getTime() : 0;
  }
  const builtShort = (s) => { const m = /^([A-Z][a-z]{2}) +(\d+) (\d{4})/.exec(s || ""); return m ? `${+m[2]} ${m[1]} ${m[3]}` : s || ""; };

  // The name, version and build date a plugin or Shelf carries inside its file.
  function readInside(bytes) {
    const t = latin(bytes), hits = [], count = {};
    const re = /(Sidequest|Checkpoint|Emblem|Scanline|Runtime|Shelf) (\d+\.\d+)( Vita)?/g;
    for (let m; (m = re.exec(t)); ) { hits.push({ name: m[1], version: m[2], vita: !!m[3] }); count[m[1]] = (count[m[1]] || 0) + 1; }
    if (!hits.length) return null;
    const name = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
    const mine = hits.filter((h) => h.name === name);
    const pick = mine.find((h) => h.vita) || mine[0];          // a PS Vita build says so; that line is the one
    const built = /\(built ([A-Z][a-z]{2} [ \d]\d \d{4} \d\d:\d\d:\d\d)\)/.exec(t);
    return { name: pick.name, version: pick.version, vita: pick.vita, built: built ? built[1] : "" };
  }
  async function sha256(bytes) {
    const c = (typeof crypto !== "undefined" && crypto.subtle) || (typeof require !== "undefined" ? require("crypto").webcrypto.subtle : null);
    if (!c) return "";
    return [...new Uint8Array(await c.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // ARK's two text files: "where, what, on|off" a line, as ARK and Shelf read them
  function arkLines(text) {
    const out = [];
    (text || "").split(/\r?\n/).forEach((raw, i) => {
      const l = raw.trim();
      if (!l || l[0] === "#" || l[0] === ";" || l.startsWith("//")) return;
      const a = l.indexOf(","), b = a < 0 ? -1 : l.indexOf(",", a + 1);
      if (b < 0) { out.push({ n: i + 1, raw: l, odd: true }); return; }
      const v = l.slice(b + 1).trim();
      out.push({ n: i + 1, raw: l, where: l.slice(0, a).trim(), what: l.slice(a + 1, b).trim(), on: /^(on|1|true|enabled)$/i.test(v) });
    });
    return out;
  }
  const rel = (p) => p.replace(/^[a-z]+\d*:\/?/i, "").replace(/\\/g, "/").replace(/^\/+/, "");      // "ms0:/SEPLUGINS/x.prx" -> "SEPLUGINS/x.prx"
  const base = (p) => p.replace(/\\/g, "/").split("/").pop().toLowerCase();
  const everywhere = (w) => /^(always|all)$/i.test(w);

  // One installed file: what it says it is, and which release it is from
  async function inspect(stick, path, table) {
    const f = stick.get(path);
    if (!f) return null;
    const bytes = await f.read(0, f.size);
    const out = { path: f.path, size: f.size, inside: null, sha: "", known: null, elf: false, pbp: false };
    out.elf = bytes.length > 4 && bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46;
    out.pbp = bytes.length > 4 && bytes[0] === 0 && bytes[1] === 0x50 && bytes[2] === 0x42 && bytes[3] === 0x50;
    out.inside = readInside(bytes);
    out.sha = await sha256(bytes);
    out.known = table.find((e) => e.sha256 === out.sha) || null;
    return out;
  }
  // The newest release of a plugin for a platform
  function newest(table, name, platform) {
    let best = null;
    for (const e of table) if (e.name === name && e.platform === platform && !e.sample && (!best || newer(e.version, best.version) || (e.version === best.version && e.release > best.release))) best = e;
    return best;
  }
  // Notes every installed file gets: is it what its name says, from a release, the newest
  function fileNotes(card, file, thing, table, kind) {
    const N = card.notes, name = thing.name;
    if (!file.size || !(file.elf || file.pbp)) {
      N.push({ level: "bad", text: `${file.path} does not look like a ${kind === "shelf" ? "program" : "plugin"} file. It may have been damaged in copying.`, fix: "Copy it again from the release zip." });
      return;
    }
    const inside = file.inside;
    if (!inside) { N.push({ level: "warn", text: `No name or version was found inside ${file.path}, so this is not one of these plugins' files.` }); return; }
    if (inside.name !== name) { N.push({ level: "bad", text: `${file.path} is ${inside.name} ${inside.version}, not ${name}. The file has the wrong name.`, fix: `Copy ${thing.id}.prx again from the release zip.` }); return; }
    card.version = inside.version + (inside.vita ? " Vita" : "");
    card.built = inside.built;
    card.vita = inside.vita;
    if (inside.built) card.facts.push(`Built ${builtShort(inside.built)}`);
    if (file.known) card.facts.push(`From release ${file.known.release}`);
    else if (file.sha) N.push({ level: "warn", text: "This is not a file from a release this page knows. It is a build of your own, a release newer than this page, or a copy that was damaged." , fix: "If you did not build it yourself, copy it again from the release zip." });
    else N.push({ level: "info", text: "This browser could not fingerprint the file, so only the version written inside it was read." });
    const where = REPO[inside.vita ? "vita" : "psp"], top = newest(table, thing.id, inside.vita ? "vita" : "psp");
    if (top && newer(top.version, inside.version)) {
      // what to do about Sidequest's states first is added once they have been counted
      N.push({ level: "warn", update: true, text: `${name} ${top.version}${inside.vita ? " Vita" : ""} is out (release ${top.release}).`, link: kind === "shelf" ? where.shelf : where.plugins });
    }
  }

  async function run(stick, official, opts) {
    opts = opts || {};
    const table = ((official && official.files) || []).concat(opts.sample && opts.extra ? opts.extra.files || [] : []);
    const cards = [];
    const card = (id, name) => { const c = { id, name, status: "", version: "", facts: [], notes: [] }; cards.push(c); return c; };

    // ---- ARK's lists ----------------------------------------------------------------------
    const lists = [];
    for (const p of LISTS) { const t = await stick.text(p); if (t !== null) lists.push({ path: stick.get(p).path, lines: arkLines(t) }); }
    const plines = [];
    for (const l of lists) for (const x of l.lines) if (!x.odd) plines.push(Object.assign({ list: l.path }, x));
    const settingsText = await stick.text(ARK + "SETTINGS.TXT");
    const settings = arkLines(settingsText);

    // ---- the plugins ------------------------------------------------------------------------
    const files = {};
    for (const P of PLUGINS) {
      const c = card(P.id, P.name);
      const mine = plines.filter((x) => base(x.what) === P.id + ".prx");
      const paths = [...new Set([...mine.map((x) => rel(x.what)), "SEPLUGINS/" + P.id + ".prx"])];
      let file = null;
      for (const p of paths) if ((file = await inspect(stick, p, table))) break;
      files[P.id] = file;
      c.lines = mine;
      if (!file && !mine.length) { c.status = "none"; continue; }
      const line = `${P.level}, ms0:/${file ? file.path.replace(/[^/]+$/, "") : "SEPLUGINS/"}${P.id}.prx, on`;
      if (!file) {
        c.notes.push({ level: "bad", text: `${mine[0].list} lists ${mine[0].what}, but that file is not on the Memory Stick.`, fix: `Copy ${P.id}.prx there from the release zip, or take the line out.` });
      } else {
        fileNotes(c, file, P, table, "plugin");
        if (!mine.length) c.notes.push({ level: lists.length ? "warn" : "bad", text: lists.length ? "It is not listed in PLUGINS.TXT, so ARK does not load it." : "There is no PLUGINS.TXT, so ARK does not load it.", fix: "Add this line to SEPLUGINS/PLUGINS.TXT and restart:", code: line });
      }
      const on = mine.filter((x) => x.on);
      if (mine.length && !on.length) { c.off = true; c.notes.push({ level: "info", text: "It is switched off in PLUGINS.TXT." }); }
      if (on.length > 1) c.notes.push({ level: "warn", text: `It is listed and switched on ${on.length} times (${[...new Set(on.map((x) => x.list))].join(" and ")}). Keep one line.` });
      for (const x of on) {
        if (P.level === "always" && !everywhere(x.where)) c.notes.push({ level: "warn", text: `Its line says "${x.where}". ${P.name}'s line has to say "always": it also has to run outside games.`, fix: "Change the line to:", code: line });
        else if (P.level === "game" && !/^(game|always|all)$/i.test(x.where)) c.notes.push({ level: "info", text: `Its line says "${x.where}", so it loads only there.` });
        if (file && rel(x.what).toUpperCase() !== file.path.toUpperCase()) c.notes.push({ level: "info", text: `A line points at ${x.what}; the file that was read is ${file.path}.` });
      }
      // what it last ran as, from the line each run opens its log with
      if (file && file.inside && file.inside.name === P.name) {
        const lf = stick.get(P.log);
        if (lf) {
          const tail = latin(await lf.read(Math.max(0, lf.size - 65536), lf.size));
          const re = new RegExp(P.name + " (\\d+\\.\\d+(?: Vita)?) \\(built ([^)]+)\\)", "g");
          let last = null;
          for (let m; (m = re.exec(tail)); ) last = m;
          if (last && last[2] !== file.inside.built) c.notes.push({ level: "info", text: `It last ran as ${P.name} ${last[1]} (built ${builtShort(last[2])}). The file on the Memory Stick is loaded at the next restart${on.length ? "" : ", once its line is switched on"}.` });
          else if (last) c.facts.push("Has run");
        } else if (on.length) c.notes.push({ level: "info", text: "No log from it was found: it has not run yet, or its folder was not in what was loaded." });
      }
    }

    // ---- Shelf ------------------------------------------------------------------------------------
    const S = card("shelf", "Shelf");
    const app = await inspect(stick, "PSP/GAME/SHELF/EBOOT.PBP", table), boot = await inspect(stick, ARK + "VBOOT.PBP", table);
    const bootIsShelf = !!(boot && boot.inside && boot.inside.name === "Shelf");
    const thing = { id: "shelf", name: "Shelf" };
    if (!app && !bootIsShelf) S.status = "none";
    else {
      fileNotes(S, app || boot, thing, table, "shelf");
      if (app && bootIsShelf && boot.sha !== app.sha) {
        const bv = boot.inside.version + (boot.inside.vita ? " Vita" : "");
        S.notes.push({ level: "warn", text: `The copy that ARK starts (VBOOT.PBP) is Shelf ${bv}, built ${builtShort(boot.inside.built)}; the one in the Game menu is Shelf ${S.version}.`, fix: "Start Shelf once from the Game menu: it brings its launcher copy up to date." });
      } else if (app && bootIsShelf) S.facts.push("Launcher copy matches");
      else if (app && boot) S.notes.push({ level: "info", text: "ARK's launcher file (VBOOT.PBP) is another launcher. Shelf puts its own copy there when it is started, and sets the other aside." });
      else if (app) S.notes.push({ level: "info", text: "Shelf is not ARK's launcher yet: it becomes that the first time it is started." });
      else S.notes.push({ level: "info", text: "Only Shelf's launcher copy was found; PSP/GAME/SHELF/EBOOT.PBP was not in what was loaded." });
      const launch = settings.find((x) => !x.odd && everywhere(x.where) && /^launcher$/i.test(x.what));
      if (settingsText !== null) S.facts.push(launch && launch.on ? "Starts at power on" : "The PSP starts in the XMB");
      const lib = await stick.bytes("SHELF/CACHE/LIBRARY.BIN", 0, 16);
      if (lib && lib.length >= 16 && u32(lib, 0) === 0x42494c53) {
        const n = u32(lib, 12);
        if (n) S.facts.push(plural(n, "game in its library", "games in its library"));
        else S.notes.push({ level: "warn", text: "Shelf's library is empty.", fix: "In Shelf: Settings > Library > Rescan. Shelf looks for games on the Memory Stick (ms0:) only." });
      }
      if (!files.runtime) S.notes.push({ level: "info", text: "Runtime is not installed, so Shelf's PS-button menu has no time-on and battery lines." });
    }
    const R = cards.find((c) => c.id === "runtime");
    if (files.runtime && S.status === "none") R.notes.push({ level: "info", text: "Shelf is not installed. Runtime shows nothing on its own: Shelf's PS-button menu is where its numbers appear." });

    // PSP builds and PS Vita builds must not be mixed, and each belongs on its own device
    const all = cards.filter((c) => c.version);
    const nv = all.filter((c) => c.vita).length, np = all.length - nv;
    const platform = nv > np ? "vita" : np ? "psp" : nv ? "vita" : "";
    const looksVita = /pspemu/i.test(opts.label || "");
    if (nv && np) {
      for (const c of all) if ((platform === "vita") !== !!c.vita) c.notes.push({ level: "bad", text: `This is the ${c.vita ? "PS Vita" : "PSP"} build; the rest of what is installed is the ${platform === "vita" ? "PS Vita" : "PSP"} one.`, fix: `Use the ${platform === "vita" ? "PS Vita" : "PSP"} build of it too.`, link: c.id === "shelf" ? REPO[platform].shelf : REPO[platform].plugins });
    } else if (np && looksVita) {
      for (const c of all) c.notes.push({ level: "warn", text: "This is the PSP build, and the folder that was loaded is a PS Vita's pspemu.", fix: "On a PS Vita, use the PS Vita build.", link: c.id === "shelf" ? REPO.vita.shelf : REPO.vita.plugins });
    }

    // ---- ARK's settings -------------------------------------------------------------------------
    const A = card("ark", "ARK-5");
    const sq = cards.find((c) => c.id === "sidequest"), sqOn = !!(files.sidequest && sq.lines.some((x) => x.on));
    if (settingsText === null && !lists.length) A.status = "none";
    else {
      if (settingsText === null) A.notes.push({ level: "info", text: "ARK's SETTINGS.TXT (PSP/SAVEDATA/ARK_01234) was not in what was loaded, so its settings were not checked." });
      const mem = settings.filter((x) => !x.odd && /^highmem\b/i.test(x.what) && x.on);
      const global = mem.find((x) => everywhere(x.where)), per = mem.filter((x) => !everywhere(x.where));
      if (global && sqOn) A.notes.push({ level: "bad", text: `Extra memory is on (${global.raw}). Sidequest needs it off.`, fix: "In Shelf: Settings > ARK-5 > Extra memory > Off. Or in ARK's own settings, Extra RAM." });
      else if (global) A.facts.push("Extra memory on");
      else if (settingsText !== null) A.facts.push("Extra memory off");
      if (per.length && sqOn) A.notes.push({ level: "info", text: `Extra memory is on for ${plural(per.length, "game", "games")} (${per.map((x) => x.where.split("/").filter(Boolean).slice(-2, -1)[0] || x.where).slice(0, 6).join(", ")}). Sidequest will not work in ${per.length === 1 ? "it" : "them"}.` });
      if (!lists.length) A.notes.push({ level: files.sidequest || files.checkpoint || files.emblem || files.scanline || files.runtime ? "bad" : "info", text: "No PLUGINS.TXT was found (SEPLUGINS/PLUGINS.TXT). Without it ARK loads no plugin." });
      else A.facts.push(lists.map((l) => l.path).join(" and "));
      for (const l of lists) {
        const odd = l.lines.filter((x) => x.odd);
        if (odd.length) A.notes.push({ level: "warn", text: `${l.path} has ${plural(odd.length, "line", "lines")} ARK cannot read (line ${odd.map((x) => x.n).join(", ")}): “${odd[0].raw.slice(0, 60)}”. A line is: where, file, on or off.` });
      }
      const others = plines.filter((x) => !PLUGINS.some((P) => base(x.what) === P.id + ".prx"));
      const loud = others.filter((x) => x.on && /^(game|always|all)$/i.test(x.where));
      if (others.length) A.notes.push({ level: "info", text: `${plural(others.length, "other plugin is", "other plugins are")} listed: ${others.map((x) => base(x.what) + (x.on ? "" : " (off)")).slice(0, 8).join(", ")}.` + (loud.length && S.status !== "none" ? ` Those at "game" or "always" also load into Shelf.` : "") });
    }

    // ---- Sidequest's states --------------------------------------------------------------------------
    const T = card("states", "Sidequest's states");
    const slots = [];
    for (const d of stick.list("SIDEQUEST").dirs) {
      for (const f of stick.list("SIDEQUEST/" + d).files) {
        if (!/\.SQS$/i.test(f.path)) continue;
        const h = await f.read(0, Math.min(404, f.size));
        if (h.length < 404 || u32(h, 0) !== 0x31535153) { slots.push({ path: f.path, bad: true }); continue; }
        slots.push({ path: f.path, version: u32(h, 4), title: cstr(h, 100, 128), when: cstr(h, 244, 32).slice(0, 16) });
      }
    }
    if (!slots.length) T.status = "none";
    else {
      T.facts.push(plural(slots.length, "state or suspend", "states and suspends"));
      const broken = slots.filter((s) => s.bad), old = slots.filter((s) => !s.bad && s.version < 5);
      if (broken.length) T.notes.push({ level: "warn", text: `${plural(broken.length, "file is", "files are")} not a whole state (${broken.slice(0, 3).map((s) => s.path).join(", ")}). A save that was cut short leaves one.`, fix: "Delete it in Sidequest's menu (△) or from the SIDEQUEST folder." });
      if (old.length) T.notes.push({ level: "bad", text: `${plural(old.length, "state is", "states are")} from before Sidequest 1.1. Sidequest refuses to load ${old.length === 1 ? "it" : "them"}.`, fix: "Delete them in Sidequest's menu (△) and take new ones." });
      // A state holds the whole system as it was. One made before what is installed now was built
      // carries older plugins and an older launcher back with it.
      let top = null;
      for (const c of all) { const t = builtTime(c.built); if (t && (!top || t > top.t)) top = { t, c }; }
      if (top) {
        const DAY = 24 * 3600 * 1000;      // the build's clock and the PSP's need not agree to the hour
        const stale = slots.filter((s) => !s.bad && s.version >= 5 && s.when && new Date(s.when.replace(" ", "T") + ":00").getTime() < top.t - DAY);
        // red, not gold: this is the one finding that can break a working setup
        if (stale.length) T.notes.push({ level: "bad", text: `${plural(stale.length, "state was", "states were")} saved before what is installed now was built (${top.c.name} ${top.c.version}, ${builtShort(top.c.built)}). A state holds the plugins and the launcher as they were when it was saved, and loading it brings those back.`, fix: "Delete them in Sidequest's menu (△) and take new ones." });
      }
    }

    // Before any update, the states have to go: a state holds the plugins and the launcher
    // as they were when it was saved. Said only when there are states to delete.
    const whole = slots.length;
    for (const c of cards) for (const n of c.notes) {
      if (n.update && whole) n.fix = `Delete your ${plural(whole, "Sidequest state or suspend", "Sidequest states and suspends")} before updating (Sidequest's menu, △), and take new ones after: a state holds the plugins as they were when it was saved.`;
    }

    // ---- Emblem's game files ---------------------------------------------------------------------------
    const E = cards.find((c) => c.id === "emblem");
    if (files.emblem) {
      const sets = stick.list("EMBLEM/games").files.filter((f) => /\.txt$/i.test(f.path)).length;
      if (sets) E.facts.push(plural(sets, "game file", "game files"));
      else E.notes.push({ level: "warn", text: "No game files were found in EMBLEM/games. Emblem has nothing to award without them.", fix: "Copy the EMBLEM folder from the release zip to the Memory Stick." });
    }

    // ---- the verdicts --------------------------------------------------------------------------------
    const counts = { bad: 0, warn: 0, info: 0, ok: 0, none: 0 };
    for (const c of cards) {
      if (c.status === "none") { counts.none++; continue; }
      c.status = c.notes.some((n) => n.level === "bad") ? "bad" : c.notes.some((n) => n.level === "warn") ? "warn" : "ok";
      for (const n of c.notes) counts[n.level]++;
      if (c.status === "ok") counts.ok++;
    }
    const found = cards.some((c) => c.status !== "none");
    return { cards, counts, platform, found, text: asText(cards, counts, platform, opts) };
  }

  // The same report as plain text, to paste into a bug report
  function asText(cards, counts, platform, opts) {
    const L = [`Shelf Tools Checkup${opts.version ? " " + opts.version : ""}${platform ? " (" + (platform === "vita" ? "PS Vita" : "PSP") + " builds)" : ""}`,
               `${counts.bad} need fixing, ${counts.warn} to look at, ${counts.info} notes`, ""];
    const mark = { bad: "[!!]", warn: "[! ]", info: "[i ]" };
    for (const c of cards) {
      if (c.status === "none") { L.push(`${c.name}: not found`); continue; }
      L.push(`${c.name}${c.version ? " " + c.version : ""}: ${c.status === "ok" ? "OK" : c.status === "warn" ? "look at this" : c.id === "states" ? "delete these" : "will not work"}${c.facts.length ? " (" + c.facts.join("; ") + ")" : ""}`);
      for (const n of c.notes) { L.push(`  ${mark[n.level]} ${n.text}`); if (n.fix) L.push(`       ${n.fix}${n.code ? " " + n.code : ""}`); }
    }
    return L.join("\n") + "\n";
  }

  const api = { run, readInside, arkLines, newest, builtTime, PLUGINS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Checkup = api;
})(typeof window !== "undefined" ? window : globalThis);
