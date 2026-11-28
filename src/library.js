/*
 * Shelf Tools - the Library: every game on the Memory Stick, with what is known of it.
 *
 *   build(stick, model)  ->  { games, totals, skipped, hasFiles, hasShelf }
 *
 * A game comes from its file on the Memory Stick (ISO/..., PSP/GAME/.../EBOOT.PBP) and
 * from Shelf's own library of it, matched by path. Where Shelf has scanned a game, its
 * title, disc ID and icon are taken from Shelf and the file is not opened at all; only
 * a game Shelf does not know is read, and then only the few pieces that hold its name
 * (src/iso.js). A file's size comes with the folder listing. So the list is there at
 * once, however many games there are.
 *
 * What takes a read per game, checking that each image is whole, is a separate step
 * (check) that the page runs after the list is shown.
 *
 * Play (time, last played, journey, achievements) is what Recap's model holds for the
 * game; favourite, completed and hidden are Shelf's marks in SHELF/games.txt.
 */
(function (root) {
  "use strict";
  const GameImage = typeof module !== "undefined" && module.exports ? require("./iso.js") : root.GameImage;

  const IMAGE = /^ISO\/.+\.(iso|cso|zso|dax)$/i, EBOOT = /^PSP\/GAME\/.+\/EBOOT\.PBP$/i, SELF = /^PSP\/GAME\/SHELF\/EBOOT\.PBP$/i;
  const up = (s) => String(s).toUpperCase();
  const tidy = (s) => s.replace(/\.(iso|cso|zso|dax|pbp)$/i, "").replace(/\s*[\[(][^\])]*[\])]/g, "").replace(/_+/g, " ").replace(/\s+/g, " ").trim();
  const fileName = (p) => p.split("/").pop();
  // "ISO/JRPG/x.iso" -> "JRPG"; "PSP/GAME/PSX/Grandia/EBOOT.PBP" -> "PSX"; as Shelf names its categories
  function category(rel) {
    const a = rel.split("/");
    if (/^ISO$/i.test(a[0])) return a.length > 2 ? a[1] : "";
    return a.length > 4 ? a[2] : "";
  }
  const minutes = (m) => (m ? new Date(new Date(2000, 0, 1).getTime() + m * 60000) : null);

  // Shelf's marks: path | last started | finished | hidden | picture | favourite
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

  async function build(stick, model) {
    const games = [], skipped = { updates: 0, notGames: 0 }, notes = [];
    const files = [...stick.files.values()].filter((f) => (IMAGE.test(f.path) || EBOOT.test(f.path)) && !SELF.test(f.path));
    const hasShelf = !!(model && model.found && model.found.shelf);
    const shelf = new Map();          // Shelf's path (upper case, without ms0:/) -> the model's game
    if (model) for (const g of model.games.values()) if (/^[a-z]+\d*:\//i.test(g.path || "")) shelf.set(up(g.path.replace(/^[a-z]+\d*:\//i, "")), g);
    const marks = new Map();
    for (const l of marksRead(await stick.text("SHELF/games.txt"))) if (l.path) marks.set(up(l.path), l);

    const make = (rel, file) => ({ key: "", title: "", fileTitle: tidy(/EBOOT\.PBP$/i.test(rel) ? rel.split("/").slice(-2, -1)[0] || "" : fileName(rel)), id: "", path: rel, shelfPath: "", file, size: file ? file.size : null,
      fmt: /EBOOT\.PBP$/i.test(rel) ? "PBP" : up(rel.split(".").pop()), type: "PSP", category: category(rel), inShelf: false, iconKey: null, icon: null,
      played: 0, last: null, launched: null, finished: null, fav: false, hidden: false, emblem: null, journey: 0, sessions: [], flags: [], whole: null });
    // what Recap's model knows of a game: time, dates, achievements
    const play = (g, m) => {
      if (!m) return;
      g.key = m.key;
      g.played = m.playedSecs || 0;
      g.sessions = m.sessions || [];
      g.journey = (m.journey || []).length;
      if (m.emblem) g.emblem = { earned: (m.earned || []).length, total: m.emblem.total };
      let last = m.launched ? m.launched.getTime() : 0;
      for (const s of g.sessions) if (s.end && s.end.getTime() > last) last = s.end.getTime();
      for (const j of m.journey || []) if (j.when && j.when.getTime() > last) last = j.when.getTime();
      for (const e of m.earned || []) if (e.when && e.when.getTime() > last) last = e.when.getTime();
      g.last = last ? new Date(last) : null;
    };
    const mark = (g, shelfPath) => {
      const l = marks.get(up(shelfPath));
      if (!l) return;
      g.fav = !!l.fav; g.hidden = !!l.hidden; g.finished = minutes(l.finished); g.launched = minutes(l.launched);
      if (g.launched && (!g.last || g.launched > g.last)) g.last = g.launched;
    };

    const seen = new Set();
    for (const f of files) {
      const g = make(f.path, f), m = shelf.get(up(f.path));
      if (m) {                      // Shelf has scanned it: nothing is read
        seen.add(up(f.path));
        Object.assign(g, { inShelf: true, title: m.title, id: m.id, type: m.type || "PSP", iconKey: m.iconKey, shelfPath: m.path });
        play(g, m); mark(g, m.path);
      } else {
        try {
          if (g.fmt === "PBP") {
            const e = await GameImage.eboot(f);
            if (!e || !e.kind) { skipped.updates++; continue; }          // an update, DLC or not a program
            Object.assign(g, { title: e.title, id: e.id, type: e.kind, icon: e.icon });
          } else if (g.fmt === "DAX") g.flags.push("dax");
          else {
            const e = await GameImage.game(f);
            if (!e) { skipped.notGames++; continue; }                     // a UMD video or music disc
            Object.assign(g, { title: e.title, id: e.id, icon: e.icon });
          }
        } catch (e) { g.flags.push("unreadable"); g.why = e && e.message ? e.message : String(e); }
        if (hasShelf) g.flags.push("new");
        if (model && g.id && model.games.has(g.id)) play(g, model.games.get(g.id));
      }
      if (!g.title) g.title = g.fileTitle || g.id || fileName(f.path);
      if (!g.key) g.key = g.id || "path:" + up(g.path);
      if (g.inShelf && g.iconKey == null) g.flags.push("noicon");
      games.push(g);
    }
    // What Shelf lists that has no file: gone, if game files were loaded at all; otherwise
    // (a zip of the data folders, the sample without its games) Shelf's list is the library.
    for (const [k, m] of shelf) {
      if (seen.has(k) || SELF.test(k)) continue;
      const g = make(m.path.replace(/^[a-z]+\d*:\//i, ""), null);
      Object.assign(g, { inShelf: true, title: m.title, id: m.id, type: m.type || "PSP", iconKey: m.iconKey, shelfPath: m.path });
      play(g, m); mark(g, m.path);
      g.key = m.key;
      if (files.length) g.flags.push("gone");
      games.push(g);
    }
    // The same disc ID in more than one file. Discs of one game ("Disc 1", "Disc 2") are not copies.
    const byId = new Map();
    for (const g of games) if (g.id && g.file) { if (!byId.has(g.id)) byId.set(g.id, []); byId.get(g.id).push(g); }
    const discless = (p) => fileName(p).replace(/[\s_.-]*(disc|disk|cd)[\s_.-]*\d+/i, "");
    for (const list of byId.values()) {
      if (list.length < 2) continue;
      if (new Set(list.map((g) => fileName(g.path))).size === list.length && new Set(list.map((g) => discless(g.path))).size === 1) continue;
      for (const g of list) { g.flags.push("dup"); g.twins = list.filter((x) => x !== g).map((x) => x.path); }
    }
    games.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) || a.path.localeCompare(b.path));
    return { games, totals: totals(games), skipped, notes, hasFiles: files.length > 0, hasShelf };
  }

  function totals(games) {
    const t = { count: games.length, bytes: 0, sized: 0, byFmt: {}, byType: {}, byCat: {}, played: 0, never: 0, done: 0, favs: 0, secs: 0, plainBytes: 0, plain: 0 };
    const add = (o, k, g) => { o[k] = o[k] || { n: 0, bytes: 0 }; o[k].n++; o[k].bytes += g.size || 0; };
    for (const g of games) {
      if (g.flags.includes("gone")) continue;
      if (g.size != null) { t.bytes += g.size; t.sized++; }
      add(t.byFmt, g.fmt, g); add(t.byType, g.type, g); add(t.byCat, g.category || "(no folder)", g);
      if (g.played >= 600) t.played++; else t.never++;
      if (g.finished) t.done++;
      if (g.fav) t.favs++;
      t.secs += g.played;
      if (g.fmt === "ISO" && g.size) { t.plain++; t.plainBytes += g.size; }
    }
    return t;
  }

  // Is each image whole? One small read a game: run after the list is on the screen.
  async function check(lib, each) {
    let n = 0;
    const todo = lib.games.filter((g) => g.file && g.fmt !== "PBP" && g.fmt !== "DAX" && g.whole === null);
    for (const g of todo) {
      try {
        const w = await GameImage.whole(g.file);
        g.whole = w.ok;
        if (!w.ok) { g.flags.push("cut"); g.why = w.why; g.need = w.need || 0; }
      } catch (e) { g.whole = false; g.flags.push("unreadable"); g.why = e && e.message ? e.message : String(e); }
      if (each) each(++n, todo.length, g);
    }
    return todo.length;
  }

  const api = { build, check, totals, marksRead, tidy, category };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Library = api;
})(typeof window !== "undefined" ? window : globalThis);
