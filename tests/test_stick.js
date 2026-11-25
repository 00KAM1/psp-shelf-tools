// Reads the sample stick (tests/sample/ms0) the way the page does, as a folder and as a
// zip, and checks what comes out against the files themselves.
const fs = require("fs"), path = require("path"), zlib = require("zlib");
const T = require("./node_stick.js"), P = require("../src/parse.js"), W = require("../src/stats.js"), S = require("../src/stick.js");
const ROOT = path.join(__dirname, "sample/ms0");
let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) pass++; else { fail++; console.log("FAIL", what); } };
const eq = (a, b, what) => ok(a === b, `${what}: got ${a}, want ${b}`);

// ---- a zip of the sample, made here with Node's zlib (deflate) -----------------------------
function makeZip(dir, prefix) {
  const files = [];
  const walk = (d, rel) => { for (const n of fs.readdirSync(d).sort()) { const f = path.join(d, n), r = rel ? rel + "/" + n : n; fs.statSync(f).isDirectory() ? walk(f, r) : files.push([r, fs.readFileSync(f)]); } };
  walk(dir, "");
  const parts = [], central = [];
  let off = 0;
  for (const [name0, data] of files) {
    const name = Buffer.from(prefix + name0);
    const store = data.length < 64;
    const body = store ? data : zlib.deflateRawSync(data);
    const crc = zlib.crc32 ? zlib.crc32(data) : 0;
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(store ? 0 : 8, 8);
    h.writeUInt16LE(0x5a00, 10); h.writeUInt16LE(0x5b78, 12); h.writeUInt32LE(crc >>> 0, 14); h.writeUInt32LE(body.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(name.length, 26);
    parts.push(h, name, body);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(store ? 0 : 8, 10);
    c.writeUInt16LE(0x5a00, 12); c.writeUInt16LE(0x5b78, 14); c.writeUInt32LE(crc >>> 0, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(off, 42);
    central.push(c, name);
    off += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, e]);
}

(async () => {
  const eng = T.engine();
  const stick = T.fromDir(ROOT, T.sampleSizes());
  const m = await P.build(stick, eng);

  // what was found
  for (const k of ["shelf", "sidequest", "checkpoint", "emblem", "runtime"]) ok(m.found[k], "found " + k);
  eq(m.games.size, 9, "games");
  const ys = m.games.get("ULUS10558");
  ok(ys && ys.title === "Ys: The Oath in Felghana", "Ys title from Shelf's library");
  eq(ys.category, "JRPG", "category from the ISO's folder");
  eq(ys.type, "PSP", "type");
  ok(ys.iconKey != null, "icon key");
  const hb = [...m.games.values()].find((g) => g.type === "Homebrew");
  ok(hb && hb.category === "Homebrew" && hb.title === "Lantern Hollow", "homebrew from PSP/GAME/Homebrew");

  // Checkpoint
  const tim = +fs.readFileSync(path.join(ROOT, "CHECKPOINT/JOURNEY/ULUS10558.TIM"), "utf8");
  eq(ys.playedSecs, tim, "Ys .TIM seconds");
  const jl = fs.readFileSync(path.join(ROOT, "CHECKPOINT/JOURNEY/ULUS10558.TXT"), "utf8").split("\n").filter((l) => /^\d{4}-/.test(l));
  eq(ys.journey.length, jl.length, "Ys journey entries");
  eq(ys.journey[0].text, jl[0].split("|")[2].trim(), "first journey text");
  ok(ys.journey.every((j, i) => !i || j.when >= ys.journey[i - 1].when), "journey in date order");
  const vdirs = fs.readdirSync(path.join(ROOT, "CHECKPOINT/ULUS10558SAVE00")).filter((n) => /^\d{8}_\d{6}$/.test(n));
  eq(ys.versions.length, vdirs.length, "Ys save versions");
  eq(ys.versions.filter((v) => v.pinned).length, 1, "pinned version");

  // Emblem
  const el = fs.readFileSync(path.join(ROOT, "EMBLEM/earned/ULUS10558.txt"), "utf8").split("\n").filter((l) => /^\d+ \|/.test(l));
  eq(ys.earned.length, el.length, "Ys earned");
  eq(ys.emblem.total, 89, "Ys total (the release file)");
  ok(ys.earned.every((e) => e.when instanceof Date && e.points > 0), "earned dates and points");

  // Sidequest
  eq(ys.slots.length, 3, "Ys slots");
  eq(ys.slots.find((s) => s.k === 0).size, T.sampleSizes()["SIDEQUEST/ULUS10558/SUSPEND.SQS"], "slot size is the file's");
  ok(ys.slots.every((s) => s.when && s.thm), "slot dates and pictures");
  const th = await P.thumb(stick, ys.slots[0].thm);
  ok(th && th.w === 240 && th.h === 136 && th.rgba.length === 240 * 136 * 4, "slot picture decodes");
  const ic = await P.icon(stick, ys.iconKey);
  ok(ic && ic.w === 144 && ic.h === 80, "icon decodes");

  // Shelf notes
  const trails = m.games.get("ULUS10540");
  ok(trails.finished && trails.finished.getFullYear() === 2026 && trails.finished.getMonth() === 4, "completed date (minutes since 2000)");
  ok(trails.fav && ys.fav, "favourites");

  // Runtime: dates without a year
  const bl = fs.readFileSync(path.join(ROOT, "RUNTIME/battery.log"), "utf8").split("\n").filter((l) => / to /.test(l));
  eq(m.powerOns.length, bl.length + 1, "power-ons: the log's, and the one in progress from uptime.txt");
  const cur = m.powerOns[m.powerOns.length - 1];
  ok(cur.current && cur.on === 95 && cur.from === 100 && cur.to === 72, "the power-on in progress");
  const lastYs = ys.sessions[ys.sessions.length - 1];
  ok(lastYs.start.getDate() === 24 && lastYs.mins === 92, "the newest session ends with the power-on in progress");
  eq(m.notes.length, 0, "nothing skipped on a good stick");
  ok(m.powerOns.every((p) => p.start.getFullYear() === 2026 && p.end >= p.start), "power-on years worked out");
  ok(bl.every((l, i) => m.powerOns[i].start.toDateString().slice(0, 3) === l.slice(0, 3)), "weekdays agree");
  ok(m.uses.length > 100 && m.uses.every((u) => u.when.getFullYear() === 2026), "use log years");
  ok(ys.sessions.length > 5, "Ys sessions from the use log");
  const dy = P.datesWithoutYear(["Wed Dec 31 23:50", "Thu Jan 1 00:10"], new Date(2026, 0, 2));
  ok(dy[0].getFullYear() === 2025 && dy[1].getFullYear() === 2026, "year boundary");
  const d2 = P.datesWithoutYear(["Mon Jan 5 19:59"], new Date(2026, 10, 24));
  ok(d2[0].getFullYear() === 2026 && d2[0].getDate() === 5, "weekday picks the year");

  // Recap
  const ps = W.periods(m);
  eq(ps[0].id, "all", "first period");
  ok(ps.some((p) => p.id === "y2026") && ps.filter((p) => p.month).length === 11, "a year and its months");
  const all = W.compute(m, ps[0]);
  const timTotal = [...m.games.values()].reduce((s, g) => s + Math.round(g.playedSecs / 60), 0);
  ok(all.minutes >= timTotal, "all time is at least Checkpoint's total");
  let monthSum = 0;
  for (const p of ps.filter((x) => x.month)) monthSum += W.compute(m, p).earned.length;
  eq(monthSum, all.earned.length, "months add up to all time (achievements)");
  eq(all.completed.length, 3, "completed");
  ok(all.power.perHour > 10 && all.power.perHour < 30, "battery per hour");
  ok(all.streak && all.streak.days >= 2, "streak");
  ok(all.hours.reduce((a, b) => a + b, 0) > 0, "hours of day");

  // the same stick from a zip, inside a folder, as a person would make it
  const zip = makeZip(ROOT, "PSP backup/");
  const blob = new Blob([zip]);
  blob.name = "stick.zip";
  const zs = await S.fromZip(blob);
  eq(zs.count, stick.count, "zip: same files");
  const zm = await P.build(zs, eng);
  eq(zm.games.size, m.games.size, "zip: same games");
  eq(zm.games.get("ULUS10558").earned.length, ys.earned.length, "zip: same earned");
  const zh = await zs.bytes("SIDEQUEST/ULUS10558/SUSPEND.SQS", 0, 404);
  eq(zh.length, 404, "zip: partial read of a deflated file");

  // names Runtime cut at 47 characters still find their game
  const lunar = m.games.get("ULUS10482");
  ok(/\(v1\.01\)\.iso$/.test(lunar.path) && lunar.sessions.length > 3, "a file name longer than Runtime's room: sessions land on the game");
  ok(![...m.games.values()].some((g) => !g.id && g.type !== "Homebrew"), "and no second, nameless copy of it appears");
  const fake = (path, when) => ({ path, journey: when ? [{ when }] : [], earned: [], versions: [], slots: [], launched: null });
  const disc1 = fake("ms0:/ISO/The Legend of Heroes Trails in the Sky SC (USA) (Disc 1).iso", new Date(2026, 5, 1, 20, 0));
  const disc2 = fake("ms0:/ISO/The Legend of Heroes Trails in the Sky SC (USA) (Disc 2).iso", new Date(2026, 8, 1, 20, 0));
  const short = fake("ms0:/ISO/Ys Seven.iso"), hbGame = fake("ms0:/PSP/GAME/Ports/LanternHollow/EBOOT.PBP");
  const names = P.programNames([disc1, disc2, short, hbGame]);
  const cut = "The Legend of Heroes Trails in the Sky SC (USA) (Disc 1).iso".slice(0, 47);
  ok(P.matchProgram(names, cut, new Date(2026, 5, 2, 21, 0)) === disc1 && P.matchProgram(names, cut, new Date(2026, 8, 3, 21, 0)) === disc2, "two discs with the same cut name: the one played around then");
  ok(P.matchProgram(names, "ys seven.iso", null) === short && P.matchProgram(names, "Ys Sev", null) === null, "a short name must match whole");
  ok(P.matchProgram(names, "LanternHollow", null) === hbGame && P.matchProgram(names, "PS1 LanternHollow", null) === hbGame, "an EBOOT by its folder");
  ok(P.matchProgram(names, "Some Game That Is Not On The Stick Any More (USA", null) === null, "a cut name of no known game matches nothing");

  // one damaged file is skipped and named; the rest still loads
  const broken = T.fromDir(ROOT, T.sampleSizes());
  broken.get("CHECKPOINT/JOURNEY/ULUS10558.TXT").read = async () => { throw new Error("read failed"); };
  const bm = await P.build(broken, eng);
  ok(bm.notes.length === 1 && bm.notes[0].includes("ULUS10558.TXT") && bm.notes[0].includes("read failed"), "a damaged file is noted");
  ok(bm.games.get("ULUS10558").journey.length === 0 && bm.games.get("ULUS10558").earned.length === ys.earned.length && bm.games.get("ULUS10540").journey.length > 0, "and only that file is lost");

  // dropped folders: entries can only be taken while the drop is handled
  const entry = (full) => {
    const st = fs.statSync(full), name = path.basename(full);
    if (st.isDirectory()) return { isFile: false, isDirectory: true, name, createReader() { let done = false; return { readEntries(okk) { okk(done ? [] : (done = true, fs.readdirSync(full).map((n) => entry(path.join(full, n))))); } }; } };
    return { isFile: true, isDirectory: false, name, file(okk) { okk(new File([fs.readFileSync(full)], name, { lastModified: st.mtimeMs })); } };
  };
  let handling = true;
  const items = fs.readdirSync(ROOT).map((n) => ({ webkitGetAsEntry: () => (handling ? entry(path.join(ROOT, n)) : null) }));
  const entries = S.dropEntries(items);
  handling = false;                                  // the event is over before any file is read
  const ds = await S.fromDrop(entries, "five folders");
  eq(ds.count, stick.count, "five folders dropped together: all files");
  const whole = await S.fromDrop(S.dropEntries([{ webkitGetAsEntry: () => entry(ROOT) }]), "the drive");
  eq(whole.count, stick.count, "the drive itself dropped: all files");

  // root finding
  eq(S.rootOf(["E:/SIDEQUEST/x/y", "E:/ISO/a.iso"]), "E:", "root above the plugin folders");
  eq(S.rootOf(["ISO/a.iso"]), null, "no plugin folders");

  console.log(`stick tests: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
