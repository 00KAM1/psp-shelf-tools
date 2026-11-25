/*
 * Shelf Tools - reading what the plugins and Shelf wrote, into one model.
 * The formats are the ones in docs/how-it-works.md; every reader here is the
 * counterpart of a writer in psp-ark-plugins or psp-shelf-launcher.
 */
(function (root) {
  "use strict";

  const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  // "2026-11-14 19:22" (Checkpoint, Emblem, Sidequest), local time
  function parseStamp(s) {
    const m = /^\s*(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(s || "");
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    return isNaN(d) ? null : d;
  }
  // minutes since 2000, local time (Shelf, Runtime)
  const fromMinutes = (m) => (m > 0 ? new Date(2000, 0, 1, 0, m) : null);
  // "20261114_192233" (Checkpoint's version folders)
  function parseVersion(s) {
    const m = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/.exec(s);
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
  }
  // "1h 05m", "12h 00m"
  function parseSpan(s) {
    const m = /(\d+)h\s*(\d+)m/.exec(s || "");
    return m ? +m[1] * 60 + +m[2] : null;
  }

  // Runtime writes "Tue Nov 24 03:30" with no year. Lines are in order, so read them
  // backwards from the file's date: each one gets the latest year, no later than the
  // line after it, whose calendar puts that weekday on that date.
  function datesWithoutYear(lines, bound) {
    let limit = bound ? new Date(bound.getTime() + 36 * 3600e3) : new Date(Date.now() + 36 * 3600e3);
    const out = new Array(lines.length).fill(null);
    for (let i = lines.length - 1; i >= 0; i--) {
      const m = /^(\w{3}) (\w{3}) (\d{1,2}) (\d{2}):(\d{2})/.exec(lines[i]);
      if (!m || !(m[2] in MON)) continue;
      for (let y = limit.getFullYear(); y >= 2000; y--) {
        const d = new Date(y, MON[m[2]], +m[3], +m[4], +m[5]);
        // a little slack: a clock set back, or two lines out of order, must not cost a year
        if (d.getMonth() !== MON[m[2]] || d.getDay() !== DOW[m[1]] || d > new Date(limit.getTime() + 3 * 86400e3)) continue;
        out[i] = d;
        if (d < limit) limit = d;
        break;
      }
    }
    return out;
  }
  // the same, for "A to B" lines: B is read first, A no later than B
  function spansWithoutYear(lines, bound) {
    const ends = datesWithoutYear(lines.map((l) => (l.split(" to ")[1] || "")), bound);
    const starts = lines.map((l, i) => (ends[i] ? datesWithoutYear([l], ends[i])[0] : null));
    return starts.map((s, i) => [s, ends[i]]);
  }

  const lines = (t) => (t || "").split(/\r?\n/);
  const cstr = (b, at, len) => {
    let e = at;
    while (e < at + len && e < b.length && b[e]) e++;
    return new TextDecoder("utf-8").decode(b.subarray(at, e));
  };
  const u32 = (b, at) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
  const base = (p) => p.replace(/\\/g, "/").split("/").pop();
  const folderOf = (p) => { const a = p.split("/"); return a.length > 1 ? a[a.length - 2] : ""; };
  const tidy = (s) => s.replace(/\.(iso|cso|zso|pbp)$/i, "").replace(/[_]+/g, " ").trim();

  // RGB565 with red in the low bits (Shelf's cache and Sidequest's pictures) -> RGBA
  function rgb565(bytes, w, h, at) {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let i = 0, p = at; i < w * h; i++, p += 2) {
      const v = bytes[p] | (bytes[p + 1] << 8);
      out[i * 4] = ((v & 31) * 255 / 31) | 0;
      out[i * 4 + 1] = (((v >> 5) & 63) * 255 / 63) | 0;
      out[i * 4 + 2] = (((v >> 11) & 31) * 255 / 31) | 0;
      out[i * 4 + 3] = 255;
    }
    return { w, h, rgba: out };
  }

  async function build(stick, engine) {
    const model = {
      games: new Map(),            // key: disc ID, or "path:<path>" for games without one
      powerOns: [], uses: [],
      found: { shelf: false, sidequest: false, checkpoint: false, emblem: false, runtime: false },
      notes: [],
      label: stick.label,
    };
    const byPath = new Map();
    function game(id, path) {
      const key = id || (path ? "path:" + path.toUpperCase() : null);
      if (!key) return null;
      let g = model.games.get(key);
      if (!g && path && byPath.has(path.toUpperCase())) g = byPath.get(path.toUpperCase());
      if (!g) {
        g = { key, id: id || "", title: "", path: path || "", type: null, category: "", iconKey: null,
              playedSecs: 0, journey: [], earned: [], emblem: null, slots: [], versions: [], saves: new Set(),
              launched: null, finished: null, fav: false, sessions: [] };
        model.games.set(key, g);
      }
      if (path && !g.path) g.path = path;
      if (path) byPath.set(path.toUpperCase(), g);
      return g;
    }

    // One unreadable or damaged file must not cost the rest: each file is read inside
    // this guard, and what was skipped is listed in model.notes for the loader to show.
    const guard = async (path, fn) => {
      try { await fn(); } catch (e) { model.notes.push(`${path}: ${e && e.message ? e.message : e}`); }
    };

    // ---- Shelf: the library (titles, icons, folders) and its notes -------------------------
    await guard("SHELF/CACHE/LIBRARY.BIN", async () => {
    const lib = await stick.bytes("SHELF/CACHE/LIBRARY.BIN");
    if (lib && lib.length >= 16 && u32(lib, 0) === 0x42494c53) {
      model.found.shelf = true;
      const entry = u32(lib, 8), n = u32(lib, 12);
      for (let i = 0; i < n && 16 + (i + 1) * entry <= lib.length; i++) {
        const at = 16 + i * entry;
        const path = cstr(lib, at, 192), title = cstr(lib, at + 192, 96), ftitle = cstr(lib, at + 288, 96), id = cstr(lib, at + 384, 16);
        const type = lib[at + 400];
        if (type === 255 || !path) continue;
        const g = game(id, path);
        g.path = path;
        g.title = title || ftitle || g.title;
        g.type = ["PSP", "PSN", "Homebrew", "PS1"][type] || "PSP";
        g.iconKey = lib[at + 401] ? u32(lib, at + 416) : null;
        const parts = path.replace(/^ms0:\//i, "").split("/");
        if (/^ISO$/i.test(parts[0]) && parts.length > 2) g.category = parts[1];
        else if (/^PSP$/i.test(parts[0]) && parts.length > 4) g.category = parts[2];
      }
    }
    });
    await guard("SHELF/games.txt", async () => {
    const notes = await stick.text("SHELF/games.txt");
    if (notes) {
      model.found.shelf = true;
      for (const l of lines(notes)) {
        if (!l.trim() || l[0] === "#") continue;
        const f = l.split("|").map((x) => x.trim());
        if (f.length < 5 || !f[0]) continue;
        const g = byPath.get(f[0].toUpperCase()) || game(null, f[0]);
        g.launched = fromMinutes(+f[1]);
        g.finished = fromMinutes(+f[2]);
        g.fav = f.length >= 6 && +f[5] !== 0;
      }
    }
    });

    // ---- Sidequest: slots ------------------------------------------------------------------
    for (const dir of stick.list("SIDEQUEST").dirs) {
      for (let k = 0; k < 6; k++) {
        const name = k === 0 ? "SUSPEND" : "STATE" + k;
        const f = stick.get(`SIDEQUEST/${dir}/${name}.SQS`);
        if (!f) continue;
        await guard(f.path, async () => {
        const h = await f.read(0, 404);
        if (h.length < 404 || u32(h, 0) !== 0x31535153) return;
        model.found.sidequest = true;
        const title = cstr(h, 100, 128), id = cstr(h, 228, 16), when = parseStamp(cstr(h, 244, 32)), boot = cstr(h, 276, 128);
        const g = (boot && byPath.get(boot.toUpperCase())) || game(id.replace("-", ""), boot);
        if (!g.title && title) g.title = title;
        const thm = stick.get(`SIDEQUEST/${dir}/${name}.THM`) ? `SIDEQUEST/${dir}/${name}.THM` : null;
        g.slots.push({ k, when, size: f.size, thm, version: u32(h, 4) });
        });
      }
    }

    // ---- Checkpoint: journey, time played, save versions --------------------------------------
    const jdir = stick.list("CHECKPOINT/JOURNEY");
    for (const f of jdir.files) {
      const m = /^(.+)\.(TXT|TIM|NEW)$/i.exec(base(f.path));
      if (!m) continue;
      await guard(f.path, async () => {
      const g = game(m[1].toUpperCase());
      model.found.checkpoint = true;
      const t = await stick.text(f.path);
      if (/TXT/i.test(m[2])) {
        for (const l of lines(t)) {
          if (!l.trim() || l[0] === "#") continue;
          const p = l.split("|").map((x) => x.trim());
          const when = parseStamp(p[0]);
          if (!when || p.length < 3 || !p[2]) continue;
          g.journey.push({ when, played: parseSpan(p[1]), text: p[2], save: p[3] || "" });
        }
        g.journey.sort((a, b) => a.when - b.when);
      } else if (/TIM/i.test(m[2]) || !g.playedSecs) {
        const v = parseInt(t, 10);
        if (v > 0) g.playedSecs = v;
      }
      });
    }
    for (const save of stick.list("CHECKPOINT").dirs) {
      if (/^JOURNEY$/i.test(save)) continue;
      const id = /^([A-Z]{4}\d{5})/i.exec(save);
      if (!id) continue;
      const vs = stick.list("CHECKPOINT/" + save);
      const stamps = new Set(vs.dirs.filter((d) => parseVersion(d)));
      if (!stamps.size) continue;
      model.found.checkpoint = true;
      const g = game(id[1].toUpperCase());
      g.saves.add(save);
      const pins = new Set(vs.files.map((f) => base(f.path)).filter((n) => /\.PIN$/i.test(n)).map((n) => n.slice(0, -4)));
      for (const s of stamps) g.versions.push({ when: parseVersion(s), save, pinned: pins.has(s) });
    }

    // ---- Emblem: game files and what is earned ------------------------------------------------
    const egames = stick.list("EMBLEM/games").files, eearned = stick.list("EMBLEM/earned").files;
    for (const f of egames) {
      const m = /^(.+)\.txt$/i.exec(base(f.path));
      if (!m) continue;
      await guard(f.path, async () => {
      model.found.emblem = true;
      const g = game(m[1].toUpperCase());
      const text = await stick.text(f.path);
      const res = engine ? engine.check(text) : null;
      if (res) {
        const inc = res.ach.filter((a) => a.included);
        g.emblem = { total: inc.length, points: inc.reduce((s, a) => s + a.points, 0), byN: new Map(res.ach.map((a) => [a.n, a])), errors: res.errors.length };
        if (!g.title && res.title) g.title = res.title;
      }
      });
    }
    for (const f of eearned) {
      const m = /^(.+)\.txt$/i.exec(base(f.path));
      if (!m) continue;
      await guard(f.path, async () => {
      model.found.emblem = true;
      const g = game(m[1].toUpperCase());
      const text = await stick.text(f.path);
      const seen = new Set();
      for (const l of lines(text)) {
        if (l[0] === "#") {
          const h = /earned in (.+) \(([^)]+)\), kept by Emblem/.exec(l);
          if (h && !g.title) g.title = h[1];
          continue;
        }
        const p = l.split("|").map((x) => x.trim());
        const n = parseInt(p[0], 10);
        if (!(n >= 1 && n <= 255) || seen.has(n)) continue;   // a number listed twice keeps its first date
        if (g.emblem && !(g.emblem.byN.get(n) || {}).included) continue;   // the viewer counts only what the file offers
        seen.add(n);
        const a = g.emblem && g.emblem.byN.get(n);
        g.earned.push({ n, when: parseStamp(p[1]), title: p[2] || (a && a.title) || "Achievement", points: a ? a.points : parseInt(p[3], 10) || 0 });
      }
      g.earned.sort((a, b) => (a.when || 0) - (b.when || 0));
      });
    }

    // ---- Runtime: power-ons and the use log -----------------------------------------------
    for (const dir of ["RUNTIME", "SHELF"]) {
      const f = stick.get(dir + "/battery.log");
      if (!f) continue;
      if (dir === "SHELF" && model.powerOns.length) continue;      // Runtime's own record wins
      await guard(f.path, async () => {
      if (dir === "RUNTIME") model.found.runtime = true;
      const ls = lines(await stick.text(f.path)).filter((l) => / to /.test(l));
      const spans = spansWithoutYear(ls, f.mtime);
      ls.forEach((l, i) => {
        const [start, end] = spans[i];
        if (!start || !end) return;
        const p = l.split("|").map((x) => x.trim());
        let on = parseSpan(p[1]), asleep = 0;
        const sl = /,\s*(\d+h\s*\d+m) asleep/.exec(p[1] || "");
        if (sl) asleep = parseSpan(sl[1]);
        if (on == null) on = Math.round((end - start) / 60000);
        const b = /battery (\d+)% to (\d+)%/.exec(l);
        model.powerOns.push({ start, end, on, asleep, from: b ? +b[1] : null, to: b ? +b[2] : null, source: dir });
      });
      });
    }
    // The power-on in progress is not in battery.log yet: Runtime keeps it in uptime.txt
    // (start, battery, last look, battery, 2, minutes asleep). Without it the newest
    // session of play would have no end and be lost.
    await guard("RUNTIME/uptime.txt", async () => {
      const t = await stick.text("RUNTIME/uptime.txt");
      if (!t) return;
      const v = t.trim().split(/\s+/).map(Number);
      if (v.length < 5 || v[4] !== 2 || !(v[0] > 0) || !(v[2] > v[0])) return;
      model.found.runtime = true;
      const start = fromMinutes(v[0]), end = fromMinutes(v[2]);
      if (model.powerOns.some((p) => Math.abs(p.start - start) < 120000)) return;
      const asleep = Math.min(v[5] > 0 ? v[5] : 0, v[2] - v[0]);
      const pct = (x) => (x >= 0 && x <= 100 ? x : null);
      model.powerOns.push({ start, end, on: v[2] - v[0] - asleep, asleep, from: pct(v[1]), to: pct(v[3]), source: "RUNTIME", current: true });
    });
    const uf = stick.get("RUNTIME/battery_use.log");
    if (uf) await guard(uf.path, async () => {
      model.found.runtime = true;
      const ls = lines(await stick.text(uf.path)).filter((l) => l.trim());
      const ds = datesWithoutYear(ls, uf.mtime);
      ls.forEach((l, i) => {
        if (!ds[i]) return;
        const p = l.split("|").map((x) => x.trim());
        const pm = /(\d+)%/.exec(p[1] || "");
        const what = p[2] || "";
        const m = /^(power on|woke|start)\s*(.*)$/.exec(what);
        model.uses.push({ when: ds[i], pct: pm ? +pm[1] : null, charging: /charging/.test(p[1] || ""), why: m ? m[1] : "", program: m ? m[2] : what });
      });
    });

    // ---- Runtime: which game each program start was --------------------------------------------
    // The use log names an ISO by its file name and an EBOOT by its folder.
    const names = new Map();
    for (const g of model.games.values()) {
      if (!g.path) continue;
      const b = base(g.path);
      names.set((/EBOOT\.PBP$/i.test(b) ? folderOf(g.path) : b).toUpperCase(), g);
      if (/EBOOT\.PBP$/i.test(b)) names.set(("PS1 " + folderOf(g.path)).toUpperCase(), g);
    }
    model.powerOns.sort((a, b) => a.start - b.start);
    // for every line, when the next start or power-on is (one pass from the end)
    const nextAt = new Array(model.uses.length).fill(null);
    for (let i = model.uses.length - 1, next = null; i >= 0; i--) {
      nextAt[i] = next;
      if (/^(start|power on)$/.test(model.uses[i].why)) next = model.uses[i].when;
    }
    let pi = 0;
    for (let i = 0; i < model.uses.length; i++) {
      const u = model.uses[i];
      if (u.why !== "start" || !u.program || /^(XMB|launcher)$/i.test(u.program)) continue;
      let g = names.get(u.program.toUpperCase());
      if (!g) {
        g = game(null, "use:" + u.program);
        if (!g.title) g.title = tidy(u.program.replace(/^PS1 /, ""));
        if (/^PS1 /.test(u.program)) g.type = "PS1";
      }
      // the session lasts until the next start or power-on, or the end of its power-on
      let end = nextAt[i];
      while (pi < model.powerOns.length - 1 && model.powerOns[pi].end < u.when) pi++;
      const at = model.powerOns[pi];
      // (lines out of order, after a clock change, fall back to a search)
      const po = at && at.start <= u.when && at.end >= u.when ? at : model.powerOns.find((p) => p.start <= u.when && p.end >= u.when) || null;
      if (po && (!end || end > po.end)) end = po.end;
      if (!end) continue;
      let mins = Math.max(0, Math.round((end - u.when) / 60000));
      // the power-on's sleep is not play: at most what is left of its time awake
      if (po) mins = Math.min(mins, Math.max(0, po.on - Math.round((u.when - po.start) / 60000)));
      end = new Date(u.when.getTime() + mins * 60000);
      if (mins > 0 && mins < 24 * 60) g.sessions.push({ start: u.when, end, mins });
    }

    for (const g of model.games.values()) {
      if (!g.title) g.title = g.id || tidy(base(g.path || "Unknown"));
      if (g.path.startsWith("use:")) g.path = "";
      g.versions.sort((a, b) => a.when - b.when);
      g.slots.sort((a, b) => (b.when || 0) - (a.when || 0));
    }
    return model;
  }

  // Shelf's picture cache: the 144x80 icon of a game
  async function icon(stick, key) {
    if (key == null) return null;
    const hex = (key >>> 0).toString(16).toUpperCase().padStart(8, "0");
    const b = await stick.bytes(`SHELF/CACHE/${hex}.IMG`, 0, 8 + 144 * 80 * 2);
    if (!b || b.length < 8 + 144 * 80 * 2 || u32(b, 0) !== 0x31434853 || !(b[4] & 1)) return null;
    return rgb565(b, 144, 80, 8);
  }
  // A Sidequest slot picture (.THM): "SQT1", width, height, pixels
  async function thumb(stick, path) {
    const b = await stick.bytes(path);
    if (!b || b.length < 8 || cstr(b, 0, 4) !== "SQT1") return null;
    const w = b[4] | (b[5] << 8), h = b[6] | (b[7] << 8);
    if (!w || !h || w > 480 || h > 272 || b.length < 8 + w * h * 2) return null;
    return rgb565(b, w, h, 8);
  }

  const api = { build, icon, thumb, parseStamp, fromMinutes, parseSpan, datesWithoutYear, spansWithoutYear, rgb565 };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.StickParse = api;
})(typeof window !== "undefined" ? window : globalThis);
