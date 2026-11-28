// The Library and the Backlog: reading a game out of an ISO, a CSO and a ZSO, the sample's
// library with the faults put in it, and what to play next.
const fs = require("fs"), path = require("path");
const G = require("../src/iso.js"), L = require("../src/library.js"), B = require("../src/backlog.js"), S = require("../src/stick.js"), P = require("../src/parse.js"), NS = require("./node_stick.js");
let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) pass++; else { fail++; console.log("FAIL", what); } };
const eq = (a, b, what) => ok(a === b, `${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const ROOT = path.join(__dirname, "sample/ms0");
const series = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/series.json"))).series;
const NOW = new Date("2026-11-24T23:00:00");

(async () => {
  const stick = NS.fromDir(ROOT, NS.sampleSizes());
  const model = await P.build(stick, await NS.engine());
  const file = (p) => stick.get(p);

  // ---- reading a game's own files, and counting what was read ------------------------------
  const counted = (f) => { const c = { reads: 0, bytes: 0, size: f.size, read: async (s, e) => { const b = await f.read(s, e); c.reads++; c.bytes += b.length; return b; } }; return c; };
  let d = new Uint8Array(64);
  ok(G.lz4(Uint8Array.from([0x40, 97, 98, 99, 100, 0x04, 0x00, 0x50, 120, 121, 122, 113, 33]), d) === 13 && Buffer.from(d.slice(0, 13)).toString() === "abcdabcdxyzq!", "LZ4: literals and a match");
  ok(G.lz4(Uint8Array.from([0x14, 97, 0x01, 0x00]), d) === 9 && Buffer.from(d.slice(0, 9)).toString() === "aaaaaaaaa", "LZ4: a match that overlaps itself");
  ok(G.lz4(Uint8Array.from([0x10, 97, 0x09, 0x00]), d) === -1 && G.lz4(Uint8Array.from([0xf0]), d) === -1, "LZ4: damaged input is refused");
  for (const [p, fmt, title, id] of [["ISO/JRPG/Ys - The Oath in Felghana (Undub).iso", "ISO", "Ys: The Oath in Felghana", "ULUS10558"],
                                      ["ISO/Strategy/Jeanne d'Arc.cso", "CSO", "Jeanne d'Arc", "UCUS98700"],
                                      ["ISO/JRPG/Trails in the Sky SC.zso", "ZSO", "The Legend of Heroes: Trails in the Sky SC", "ULUS10578"]]) {
    const c = counted(file(p)), g = await G.game(c);
    ok(g && g.fmt === fmt && g.title === title && g.id === id, `${fmt}: title and disc ID read (${g && g.title})`);
    const icon = await g.icon();
    ok(icon && icon[1] === 0x50 && icon[2] === 0x4e && icon[3] === 0x47, `${fmt}: the icon is a PNG`);
    ok(c.bytes < 64 * 1024 && c.reads < 40, `${fmt}: read in small pieces, not the image (${c.reads} reads, ${c.bytes} bytes of ${c.size})`);
  }
  let c = counted(file("ISO/JRPG/Persona 3 Portable (Undub).iso")), w = await G.whole(c);
  ok(w.ok && c.reads === 2 && c.bytes <= 24 + 2048, `an ISO is checked with one small read past its first bytes (${c.reads} reads, ${c.bytes} bytes)`);
  c = counted(file("ISO/Strategy/Jeanne d'Arc.cso")); w = await G.whole(c);
  ok(w.ok && c.bytes === 28, `a CSO is checked from its header and one index entry (${c.bytes} bytes)`);
  w = await G.whole(file("ISO/Strategy/Tactics Ogre - Let Us Cling Together.iso"));
  ok(!w.ok && /should be 1142947840 bytes and is 337641472/.test(w.why), "an image that says it is larger than its file is cut short");
  const cso = file("ISO/Strategy/Jeanne d'Arc.cso"), real = fs.statSync(path.join(ROOT, "ISO/Strategy/Jeanne d'Arc.cso")).size;
  w = await G.whole({ size: real - 500, read: cso.read });
  ok(!w.ok && w.need === real, "a CSO whose last block ends past the file is cut short");
  ok(!(await G.whole({ size: 0, read: async () => new Uint8Array(0) })).ok && !(await G.whole({ size: 30, read: async () => new Uint8Array(24) })).ok, "an empty or tiny file is not whole");
  let e = await G.eboot(file("PSP/GAME/Homebrew/LanternHollow/EBOOT.PBP"));
  ok(e.kind === "Homebrew" && e.title === "Lantern Hollow" && (await e.icon()).length > 1000, "an EBOOT.PBP: kind, title, icon");
  e = await G.eboot(file("PSP/GAME/NPJH50332/EBOOT.PBP"));
  eq(e.kind, "", "an update's EBOOT.PBP is not a game");

  // ---- the Library on the sample ----------------------------------------------------------------
  const reads = { n: 0 };
  const watched = new S.Stick([...stick.files.values()].map((f) => Object.assign({}, f, { read: async (s, e2) => { if (/^ISO\//.test(f.path)) reads.n++; return f.read(s, e2); } })), "sample");
  const lib = await L.build(watched, model);
  eq(lib.games.length, 12, "twelve games: nine Shelf knows and three it does not");
  const g = (t, n) => lib.games.filter((x) => x.title === t)[n || 0];
  const ys = g("Ys: The Oath in Felghana");
  ok(ys.inShelf && ys.id === "ULUS10558" && ys.category === "JRPG" && ys.fmt === "ISO" && ys.size === 505413632 && ys.fav && !ys.finished && ys.iconKey != null, "a game Shelf knows: its facts and marks");
  ok(ys.played > 40 * 3600 && ys.last && ys.emblem.earned === 41 && ys.emblem.total === 89, "and its play, from Recap's model");
  ok(g("Jeanne d'Arc").finished && g("Jeanne d'Arc").fmt === "CSO" && g("Lantern Hollow").type === "Homebrew" && g("Lantern Hollow").fmt === "PBP", "completed, formats and kinds");
  const sc = g("The Legend of Heroes: Trails in the Sky SC");
  ok(sc && !sc.inShelf && sc.flags.includes("new") && sc.id === "ULUS10578" && sc.fmt === "ZSO" && typeof sc.icon === "function", "a game Shelf has not scanned is read from its own file");
  ok(g("Ys Seven", 0).flags.includes("dup") && g("Ys Seven", 1).flags.includes("dup") && g("Ys Seven", 0).twins.length === 1, "the same disc ID in two files");
  ok(lib.skipped.updates === 1 && !lib.games.some((x) => /SHELF|NPJH50332/.test(x.path)), "an update folder and Shelf itself are not games");
  eq(reads.n <= 3 * 12, true, `the nine games Shelf knows cost no read; the three it does not, a few each (${reads.n} reads in all)`);
  const before = reads.n;
  let seen = 0;
  eq(await L.check(lib, () => seen++), 11, "eleven images to check (the EBOOT is not one)");
  ok(seen === 11 && reads.n - before <= 22, `the check is at most two small reads a game (${reads.n - before})`);
  ok(g("Tactics Ogre: Let Us Cling Together").flags.includes("cut") && g("Tactics Ogre: Let Us Cling Together").whole === false && ys.whole === true, "the cut-short image is found, the others are whole");
  const t = L.totals(lib.games);
  ok(t.count === 12 && t.byFmt.ISO.n === 9 && t.byFmt.CSO.n === 1 && t.byFmt.ZSO.n === 1 && t.byCat.JRPG.n === 8 && t.done === 3 && t.favs === 3 && t.never === 3 && t.bytes > 10e9, "totals: " + JSON.stringify(t.byFmt));

  // without the game files (a zip of the data folders): Shelf's own list is the library
  const dataOnly = new S.Stick([...stick.files.values()].filter((f) => !/^(ISO|PSP)\//.test(f.path)), "zip");
  let lib2 = await L.build(dataOnly, await P.build(dataOnly, await NS.engine()));
  ok(lib2.games.length === 9 && !lib2.hasFiles && lib2.games.every((x) => x.size === null && !x.flags.length), "without game files: Shelf's nine, sizes unknown, nothing flagged");
  // a game Shelf lists whose file is gone
  const gone = new S.Stick([...stick.files.values()].filter((f) => !/Valkyria/.test(f.path)), "x");
  lib2 = await L.build(gone, model);
  ok(lib2.games.find((x) => /Valkyria/.test(x.title)).flags.includes("gone") && L.totals(lib2.games).count === 12, "a game Shelf lists but whose file is gone");
  // two discs of one game are not copies of each other
  const twoDiscs = new S.Stick([...stick.files.values()].filter((f) => !/Ys Seven/.test(f.path)).concat(
    ["Disc 1", "Disc 2"].map((n) => Object.assign({}, file("ISO/JRPG/Ys Seven.iso"), { path: `ISO/JRPG/Ys Seven (${n}).iso` }))), "x");
  lib2 = await L.build(twoDiscs, model);
  ok(lib2.games.filter((x) => /Ys Seven/.test(x.path)).every((x) => !x.flags.includes("dup")), "Disc 1 and Disc 2 of a game are not flagged as copies");
  // without Shelf at all: everything is read from the games
  const noShelf = new S.Stick([...stick.files.values()].filter((f) => !/^SHELF\//.test(f.path)), "x");
  lib2 = await L.build(noShelf, await P.build(noShelf, await NS.engine()));
  ok(lib2.games.length === 12 && !lib2.hasShelf && lib2.games.every((x) => !x.flags.includes("new")) && lib2.games.find((x) => x.id === "ULUS10558").title === "Ys: The Oath in Felghana" && lib2.games.find((x) => x.id === "ULUS10558").played > 0, "without Shelf: titles from the games, play from Checkpoint");

  // ---- the Backlog -----------------------------------------------------------------------------------
  let p = B.plan(lib.games, series, {}, NOW);
  eq(p.playing.map((r) => r.g.id).join(), "ULUS10558,ULUS10512,ULUS10515", "playing: touched in the last 30 days, newest first");
  eq(p.done.length + "," + p.paused.map((r) => r.g.id).join() + "," + p.fresh.length, "3,ULUS10560,ULUS10551,3", "done, paused and never started");
  eq(p.rows.length, 11, "two copies of one game are one thing to play");
  ok(p.suggest[0].g.id === "ULUS10578" && /^Next in Trails \(Kiseki\): you have finished Trails in the Sky$/.test(p.suggest[0].reasons[0]), "first suggestion: the next game of a series whose first is completed");
  ok(p.suggest.some((r) => r.g.id === "ULUS10560" && /You are 2h in, last played 3 months ago/.test(r.reasons.join())), "a game left part-way is suggested, with how far in");
  ok(!p.suggest.some((r) => r.g.id === "ULUS10565") && !p.suggest.some((r) => p.playing.includes(r)), "a cut-short game and the ones being played are not suggested");
  const tr = p.series.find((s) => s.name === "Trails (Kiseki)"), yy = p.series.find((s) => s.name === "Ys");
  eq(tr.entries.map((x) => (x.row ? x.row.state : "-")).join(), "done,fresh,-,-,-", "Trails: what is done, what is next, what is not on the Memory Stick");
  ok(tr.next === "ULUS10578" && yy.entries[1].row.g.id === "ULUS10558" && yy.entries[3].row.g.id === "ULUS10551" && !p.series.some((s) => s.name === "Persona 2"), "series: the next game; a series with no game here is left out");
  ok(!p.rows.find((r) => r.g.id === "ULUS10551").reasons.some((x) => /comes first/.test(x)), "Ys, whose games stand alone, holds nothing back");
  ok(Math.abs(p.pace - 9.46) < 0.1 && p.weekly === p.pace && p.ahead.weeks === null, "pace measured from the last four weeks; no finish date without lengths");
  // lengths, a queue, skipping, hours a week
  p = B.plan(lib.games, series, { length: { ULUS10558: 50, ULUS10560: 6, ULUS10578: 60 }, queue: ["ULUS10578", "ULUS10540", "nope"], skip: ["ULUS10551"], weekly: 5 }, NOW);
  eq(p.queue.map((r) => r.g.id).join(), "ULUS10578", "the queue: in your order, without what is done or gone");
  ok(!p.suggest.some((r) => r.g.id === "ULUS10578" || r.g.id === "ULUS10551") && !p.fresh.some((r) => r.g.id === "ULUS10578") && p.skipped.length === 1, "queued and skipped games are not suggested again");
  ok(p.suggest[0].g.id === "ULUS10560" && /Nearly done: about 4h left/.test(p.suggest[0].reasons[0]), "a game nearly done comes first");
  const fel = p.playing.find((r) => r.g.id === "ULUS10558");
  ok(Math.abs(fel.left - 4) < 0.1 && p.ahead.known === 2 && Math.abs(p.ahead.hours - 64) < 0.2 && Math.abs(p.ahead.weeks - 12.8) < 0.1 && p.weekly === 5, `time ahead: ${p.ahead.hours.toFixed(1)}h, ${p.ahead.weeks.toFixed(1)} weeks at 5h a week`);
  eq(B.fits(p, 5).map((r) => r.g.title).join(" | "), "Final Fantasy IV: The Complete Collection | Ys: The Oath in Felghana", "what fits in five hours, least first");
  eq(B.fits(p, 3).length, 0, "nothing fits in three");
  // a strict series holds its later games back
  const fake = (title, o) => Object.assign({ key: title, title, fileTitle: title, path: "ISO/" + title + ".iso", flags: [], played: 0, last: null, finished: null, fav: false, sessions: [], emblem: null }, o);
  p = B.plan([fake("Trails in the Sky"), fake("Trails in the Sky SC (USA) (Disc 1)"), fake("Legend of Heroes Zero no Kiseki [T-En]"), fake("Ys vs Sora no Kiseki Alternative Saga"), fake("英雄伝説　碧の軌跡")], series, {}, NOW);
  const kis = p.series.find((s) => s.name === "Trails (Kiseki)");
  eq(kis.entries.map((x) => (x.row ? "x" : "-")).join(""), "xx-xx", "titles are matched to their entries, Japanese ones too; Ys vs Sora no Kiseki is not one of them");
  ok(p.rows.find((r) => /Zero/.test(r.key)).after === "Trails in the Sky" && p.rows.find((r) => /Zero/.test(r.key)).score < 0 && !p.suggest.length, "in a series that is one story, a later game waits for the first");
  ok(!p.series.some((s) => s.name === "Ys") && p.pace === null, "a look-alike is kept out; no sessions, no pace");
  eq(B.stateOf(fake("x", { played: 3600, last: new Date("2026-11-01") }), NOW.getTime()) + B.stateOf(fake("x", { played: 3600 }), NOW.getTime()) + B.stateOf(fake("x", { played: 30 }), NOW.getTime()) + B.stateOf(fake("x", { finished: new Date() }), NOW.getTime()), "playingpausedfreshdone", "the four states");
  ok(series.every((s) => s.entries.every((x) => x.match.every((m) => { try { new RegExp(m, "u"); return m === m.toLowerCase(); } catch (er) { return false; } }))), "every pattern in data/series.json is a valid, lower-case pattern");

  console.log(`library and backlog: ${pass} checks passed` + (fail ? `, ${fail} FAILED` : ""));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
