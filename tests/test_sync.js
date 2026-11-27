// Sync, run on real folders: a PSP's Memory Stick (the sample, with saves added), a PS
// Vita's pspemu folder and a vault, taken through first syncs, play on each device, a
// save changed on both, a removed save, and syncs that are cut short.
const fs = require("fs"), path = require("path"), os = require("os");
const C = require("../src/sync.js"), { MemDir } = require("../src/syncdir.js"), { NodeDir } = require("./node_dir.js");
let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) pass++; else { fail++; console.log("FAIL", what); } };
const eq = (a, b, what) => ok(a === b, `${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "shelfsync-"));
const SAMPLE = path.join(__dirname, "sample/ms0");
const put = (root, rel, data, when) => {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, data);
  if (when) fs.utimesSync(f, new Date(when), new Date(when));
};
const get = (root, rel) => fs.readFileSync(path.join(root, rel));
const has = (root, rel) => fs.existsSync(path.join(root, rel));
const text = (root, rel) => get(root, rel).toString("utf8");
const save = (root, name, title, detail, body, when, dirs) => {
  const d = (dirs || "PSP/SAVEDATA") + "/" + name;
  put(root, d + "/PARAM.SFO", C.sfoWrite({ TITLE: title, SAVEDATA_TITLE: detail, SAVEDATA_DETAIL: detail + " detail" }), when);
  put(root, d + "/DATA.BIN", Buffer.from(body), when);
  put(root, d + "/ICON0.PNG", Buffer.from("icon of " + title), when);
};
const sync = async (stickRoot, vaultRoot, name, tweak, hooks) => {
  const S = new NodeDir(stickRoot), V = new NodeDir(vaultRoot);
  if (hooks && hooks.dirs) hooks.dirs(S, V);
  const s = await C.scan(S, "stick"), v = await C.scan(V, "vault");
  const P = C.plan(s, v);
  if (tweak) tweak(P);
  if (hooks && hooks.before) hooks.before(S, V);
  const R = P.errors.length ? null : await C.apply(P, S, V, { deviceName: name, now: hooks && hooks.now });
  return { P, R };
};
const acts = (P, kind) => P.items.filter((i) => i.kind === kind).map((i) => `${i.key}:${i.action || C.dirOf(i)}`).join(" ");

(async () => {
  // ---- the pieces ---------------------------------------------------------------------------
  const sfo = C.sfoRead(C.sfoWrite({ TITLE: "Ys: The Oath in Felghana", SAVEDATA_TITLE: "Town of Redmont", SAVEDATA_DETAIL: "Lv 12 英雄伝説" }));
  eq(sfo.TITLE, "Ys: The Oath in Felghana", "PARAM.SFO title");
  eq(sfo.SAVEDATA_DETAIL, "Lv 12 英雄伝説", "PARAM.SFO Japanese detail");
  ok(C.SAVE_RE.test("ULUS10558SAVE00") && C.SAVE_RE.test("NPJH50342_01") && C.SAVE_RE.test("SLUS00892"), "game saves are taken");
  ok(!C.SAVE_RE.test("ARK_01234") && !C.SAVE_RE.test("PSPFILER") && !C.SAVE_RE.test("ULUS1055"), "ARK's folder and others are not");

  // achievements: joined; on both, the first date; a number twice in one file keeps its first
  {
    const a = "# Achievements earned in Ys (ULUS10558), kept by Emblem\r\n2 | 2026-09-03 23:22 | A | 5 pts\r\n7 | 2026-09-12 22:45 | C | 5 pts\r\n7 | 2026-10-01 10:00 | C | 5 pts\r\n";
    const b = "# Achievements earned in Ys (ULUS10558), kept by Emblem\r\n7 | 2026-09-10 08:00 | C | 5 pts\r\n9 | 2026-11-01 09:00 | D | 10 pts\r\n";
    const m = C.earnedMerge(a, b);
    eq(m.count, 3, "earned: three in all");
    eq(C.earnedRead(m.textS).byN.get(7).date, "2026-09-10 08:00", "earned: the first date stands");
    eq([...C.earnedRead(m.textS).byN.keys()].join(","), "2,7,9", "earned: in date order");
    ok(!m.sameS && !m.sameV && m.addS === 1 && m.addV === 1, "earned: each side gets one");
    const again = C.earnedMerge(m.textS, m.textV);
    ok(again.sameS && again.sameV, "earned: joined files need nothing more");
    ok(m.textS.startsWith("# Achievements earned in Ys") && /\r\n$/.test(m.textS), "earned: header and line ends kept");
    const one = C.earnedMerge(a, null);
    ok(one.sameS && !one.sameV && one.addV === 2, "earned: a side with none gets them all");
  }

  // journey: lines joined, time added up
  {
    const H = "# Journey log of ULUS10558, kept by Checkpoint: date | time played | description | save\r\n";
    const base = H + "2026-09-04 00:28 | 1h 29m | Town of Redmont | ULUS10558SAVE00\r\n2026-09-18 22:31 | 10h 00m | Tigray Quarry | ULUS10558SAVE00\r\n";
    const psp = base + "2026-11-23 20:00 | 12h 00m | Ilvern Ruins | ULUS10558SAVE00\r\n";            // Monday: 2 hours on the PSP
    const vita = base + "2026-11-24 21:00 | 11h 00m | Elderm Mountains | ULUS10558SAVE00\r\n";       // Tuesday: 1 hour on the Vita
    const m = C.journeyMerge("ULUS10558", { txt: vita, tim: 39600 }, { txt: psp, tim: 43200 }, { s: 36000, v: 36000 });
    eq(m.tim, 46800, "journey: 10h + 2h + 1h");
    const J = C.journeyRead(m.txtS);
    eq(J.list.map((e) => e.mins).join(","), "89,600,720,780", "journey: totals run on across devices");
    eq(J.list[3].text, "Elderm Mountains", "journey: lines in date order");
    ok(m.addS === 1 && m.addV === 1 && m.gainS === 7200 && m.gainV === 3600, "journey: what each side gains");
    // the other way round (the Vita was synced first) gives the same file
    const r = C.journeyMerge("ULUS10558", { txt: psp, tim: 43200 }, { txt: vita, tim: 39600 }, { s: 36000, v: 36000 });
    eq(C.journeyRead(r.txtS).list.map((e) => e.key + e.mins).join(), J.list.map((e) => e.key + e.mins).join(), "journey: the same whichever device is synced first");
    // nothing new on one side: its lines are not rewritten
    const o = C.journeyMerge("ULUS10558", { txt: psp, tim: 43200 }, { txt: base, tim: 36000 }, { s: 36000, v: 36000 });
    ok(o.txtS === null && !o.timS && o.txtV !== null && o.timV && o.tim === 43200, "journey: only the side that is behind is written");
    // the same on both: nothing
    const n = C.journeyMerge("ULUS10558", { txt: psp, tim: 43200 }, { txt: psp, tim: 43200 }, { s: 43200, v: 43200 });
    ok(n.txtS === null && n.txtV === null && !n.timS && !n.timV, "journey: level sides need nothing");
    // a first sync of two devices that never met: their hours add up
    const f = C.journeyMerge("X", { txt: H + "2026-01-02 10:00 | 3h 00m | A | S\r\n", tim: 11000 }, { txt: H + "2026-01-01 10:00 | 5h 00m | B | S\r\n", tim: 18500 }, null);
    eq(f.tim, 29500, "journey: a first sync adds both devices' time");
    eq(C.journeyRead(f.txtS).list.map((e) => e.mins).join(","), "300,480", "journey: first sync totals");
    // a first sync of a copy of the same Memory Stick: counted once
    const c = C.journeyMerge("X", { txt: psp, tim: 43200 }, { txt: psp, tim: 43200 }, null);
    eq(c.tim, 43200, "journey: the same history is not counted twice");
    const c2 = C.journeyMerge("X", { txt: psp, tim: 43200 }, { txt: base, tim: 36000 }, null);
    eq(c2.tim, 43200, "journey: shared lines are shared play");
    // Japanese text and a line that is not an entry survive
    const jp = C.journeyMerge("NPJH50342", { txt: "# head\r\nnot a line\r\n2026-05-01 10:00 | 2h 05m | 第一章 ロレント | NPJH50342_01\r\n", tim: 7500 }, null, null);
    ok(jp.txtV.includes("第一章 ロレント") && jp.txtV.includes("not a line") && jp.tim === 7500 && jp.txtS === null, "journey: Japanese text and odd lines kept");
    // time with no lines at all
    const t = C.journeyMerge("X", { txt: null, tim: 600 }, { txt: null, tim: 900 }, { s: 500, v: 500 });
    ok(t.tim === 1000 && t.txtS === null && t.txtV === null && t.timS && t.timV, "journey: time alone");
    // the device's file was not written last time: it stands at 600 where the vault went on to 1000
    const u = C.journeyMerge("X", { txt: null, tim: 600 }, { txt: null, tim: 1000 }, { s: 600, v: 1000 });
    ok(u.tim === 1000 && u.timS && !u.timV, "journey: play already taken in is not added again");
    const u2 = C.journeyMerge("X", { txt: null, tim: 650 }, { txt: null, tim: 1000 }, { s: 600, v: 1000 });
    eq(u2.tim, 1050, "journey: only what was played since is added");
  }

  // ---- a PSP: the sample Memory Stick, with the saves Checkpoint has versions of --------------
  const PSP = path.join(TMP, "PSP"), VITA = path.join(TMP, "card/pspemu"), VAULT = path.join(TMP, "vault");
  fs.cpSync(SAMPLE, PSP, { recursive: true });
  fs.mkdirSync(VAULT);
  save(PSP, "ULUS10558SAVE00", "Ys: The Oath in Felghana", "Ilvern Ruins", "ys save 1", "2026-11-20T20:00:00");
  save(PSP, "ULUS10558SYS", "Ys: The Oath in Felghana", "System", "ys system", "2026-11-20T20:00:00");
  save(PSP, "ULUS10512SAVE00", "Persona 3 Portable", "4/28 Dorm", "p3p save", "2026-11-21T20:00:00");
  put(PSP, "PSP/SAVEDATA/ARK_01234/SETTINGS.TXT", "always, usbcharge, on\r\n");
  put(PSP, "PSP/SAVEDATA/ARK_01234/VBOOT.PBP", "the launcher");
  put(PSP, "PSP/SAVEDATA/NPUH10117DATA/BIG.BIN", Buffer.alloc(C.BIG + 1));
  put(PSP, "ISO/JRPG/Ys Seven.iso", "not really");
  const journeys = fs.readdirSync(path.join(SAMPLE, "CHECKPOINT/JOURNEY")).filter((n) => /TIM$/.test(n)).length;
  const earnedN = fs.readdirSync(path.join(SAMPLE, "EMBLEM/earned")).length, setsN = fs.readdirSync(path.join(SAMPLE, "EMBLEM/games")).length;

  // wrong folders are refused before anything is written
  {
    const empty = path.join(TMP, "empty"); fs.mkdirSync(empty);
    let r = await sync(empty, VAULT, "x");
    ok(r.P.errors.length === 1 && /No PSP, SIDEQUEST/.test(r.P.errors[0]) && !r.R, "an empty folder is not a Memory Stick");
    r = await sync(PSP, PSP, "x");
    ok(r.P.errors.some((e) => /vault is a Memory Stick/.test(e)), "a Memory Stick is not a vault");
    const docs = path.join(TMP, "docs"); put(docs, "taxes.txt", "x");
    r = await sync(PSP, docs, "x");
    ok(r.P.errors.some((e) => /other files/.test(e)) && !has(docs, "SYNC"), "a folder with other files is not made a vault");
  }

  // 1. the PSP's first sync fills the vault
  let r = await sync(PSP, VAULT, "PSP-3000", null, { now: "2026-11-27T10:00:00" });
  eq(acts(r.P, "save"), "ULUS10512SAVE00:toVault ULUS10558SAVE00:toVault ULUS10558SYS:toVault", "1: every save goes to the vault");
  eq(r.R.failed.length, 0, "1: nothing failed");
  ok(get(VAULT, "PSP/SAVEDATA/ULUS10558SAVE00/DATA.BIN").equals(get(PSP, "PSP/SAVEDATA/ULUS10558SAVE00/DATA.BIN")), "1: the save is in the vault");
  ok(!has(VAULT, "PSP/SAVEDATA/ARK_01234") && !has(VAULT, "PSP/SAVEDATA/NPUH10117DATA"), "1: ARK's folder and installed game data stay out");
  ok(r.P.notes.some((n) => /NPUH10117DATA is 32 MB/.test(n)), "1: the page says what it left alone");
  eq(fs.readdirSync(path.join(VAULT, "CHECKPOINT/JOURNEY")).filter((n) => /TIM$/.test(n)).length, journeys, "1: journeys in the vault");
  eq(fs.readdirSync(path.join(VAULT, "EMBLEM/earned")).length, earnedN, "1: achievements in the vault");
  eq(fs.readdirSync(path.join(VAULT, "EMBLEM/games")).length, setsN, "1: Emblem game files in the vault");
  ok(has(VAULT, `SYNC/devices/${r.R.device.id}/RUNTIME/battery.log`), "1: Runtime's logs kept per device");
  ok(!has(VAULT, "SIDEQUEST") && !has(VAULT, "CHECKPOINT/ULUS10558SAVE00") && !has(VAULT, "SHELF"), "1: states, save versions and Shelf's cache stay on the device");
  const st1 = JSON.parse(text(PSP, "SYNC/STATE.JSON")), ix1 = JSON.parse(text(VAULT, "SYNC/VAULT.JSON"));
  ok(st1.vault === ix1.id && st1.device.name === "PSP-3000" && ix1.devices[st1.device.id].name === "PSP-3000", "1: the device and the vault know each other");
  ok(ix1.marks.ULUS10558 && ix1.marks.ULUS10558.fav === 1 && ix1.marks.UCUS98700.finished > 0, "1: Shelf's marks are in the vault by disc ID");
  ok(/PSP-3000: 3 saves to the vault/.test(text(VAULT, "SYNC/log.txt")) && has(VAULT, "SYNC/README.txt"), "1: the log and the read-me");
  const before = text(PSP, "CHECKPOINT/JOURNEY/ULUS10558.TXT"), gamesTxt = text(PSP, "SHELF/games.txt");

  // 2. again at once: nothing to do, nothing rewritten
  r = await sync(PSP, VAULT, null, null, { now: "2026-11-27T10:05:00" });
  eq(r.P.items.length, 0, "2: a second sync finds nothing: " + r.P.items.map((i) => i.kind + " " + i.key).join(", "));
  eq(r.P.same.save, 3, "2: three saves the same");
  eq(text(PSP, "CHECKPOINT/JOURNEY/ULUS10558.TXT"), before, "2: the journey is untouched");
  eq(text(PSP, "SHELF/games.txt"), gamesTxt, "2: Shelf's marks are untouched");

  // 3. a PS Vita that has played a little on its own; lower-case folders, another ISO name
  save(VITA, "ULUS10558SAVE00", "Ys: The Oath in Felghana", "Town of Redmont", "ys on the vita", "2026-11-10T20:00:00", "psp/savedata");
  save(VITA, "ULUS10560SAVE00", "Final Fantasy IV", "Baron", "ff4 on the vita", "2026-11-22T20:00:00", "psp/savedata");
  put(VITA, "CHECKPOINT/JOURNEY/ULUS10560.TXT", "# Journey log of ULUS10560, kept by Checkpoint: date | time played | description | save\r\n2026-11-22 20:00 | 0h 40m | Baron | ULUS10560SAVE00\r\n");
  put(VITA, "CHECKPOINT/JOURNEY/ULUS10560.TIM", "2500\n");
  put(VITA, "EMBLEM/earned/ULUS10558.txt", "# Achievements earned in Ys: The Oath in Felghana (ULUS10558), kept by Emblem\r\n2 | 2026-08-01 10:00 | The Azure Queen of Death | 5 pts\r\n200 | 2026-11-10 20:10 | Only on the Vita | 5 pts\r\n");
  // its Shelf library: the same Ys under another file name, and nothing marked
  {
    const lib = get(PSP, "SHELF/CACHE/LIBRARY.BIN"), entry = lib.readUInt32LE(8), n = lib.readUInt32LE(12);
    for (let i = 0; i < n; i++) {
      const at = 16 + i * entry, id = lib.toString("latin1", at + 384, at + 393);
      if (id === "ULUS10558") { lib.fill(0, at, at + 192); lib.write("ms0:/ISO/Ys Felghana [Vita copy].iso", at, "latin1"); }
    }
    put(VITA, "SHELF/CACHE/LIBRARY.BIN", lib);
  }
  const ff4Before = +text(VAULT, "CHECKPOINT/JOURNEY/ULUS10560.TIM"), earnedPsp = C.earnedRead(text(PSP, "EMBLEM/earned/ULUS10558.txt"));
  r = await sync(VITA, VAULT, "Vita 1", null, { now: "2026-11-27T11:00:00" });
  eq(acts(r.P, "save"), "ULUS10512SAVE00:toStick ULUS10558SAVE00:conflict ULUS10558SYS:toStick ULUS10560SAVE00:toVault", "3: a first sync asks about the save both have");
  eq(r.P.items.find((i) => i.key === "ULUS10558SAVE00").choice, "vault", "3: the newer one is offered (the PSP's, in the vault)");
  eq(r.P.items.find((i) => i.key === "ULUS10558SAVE00").fromV, "PSP-3000", "3: and the page can say whose it is");
  eq(r.R.failed.length, 0, "3: nothing failed: " + r.R.failed.map((f) => f.key + " " + f.error).join("; "));
  ok(get(VITA, "psp/savedata/ULUS10558SAVE00/DATA.BIN").toString() === "ys save 1", "3: the Vita has the PSP's save");
  ok(!has(VITA, "PSP") && has(VITA, "psp/savedata/ULUS10512SAVE00/PARAM.SFO"), "3: written into the folders that are there, whatever their case");
  const hist = fs.readdirSync(path.join(VAULT, "SYNC/history/ULUS10558SAVE00"));
  ok(hist.length === 1 && get(VAULT, `SYNC/history/ULUS10558SAVE00/${hist[0]}/DATA.BIN`).toString() === "ys on the vita", "3: the save it replaced is kept in the vault");
  eq(+text(VAULT, "CHECKPOINT/JOURNEY/ULUS10560.TIM"), ff4Before + 2500, "3: Final Fantasy IV's time on both devices is added up");
  eq(+text(VITA, "CHECKPOINT/JOURNEY/ULUS10560.TIM"), ff4Before + 2500, "3: and the Vita shows the same");
  ok(text(VITA, "CHECKPOINT/JOURNEY/ULUS10560.TXT").includes("| Baron |") && text(VAULT, "CHECKPOINT/JOURNEY/ULUS10560.TXT").includes("| Baron |"), "3: the Vita's journey line is on both");
  { const l = C.journeyRead(text(VITA, "CHECKPOINT/JOURNEY/ULUS10560.TXT")).list; ok(l.every((e, i) => !i || e.mins >= l[i - 1].mins || e.stamp < l[i - 1].stamp), "3: journey totals do not run backwards"); }
  const ev = C.earnedRead(text(VAULT, "EMBLEM/earned/ULUS10558.txt"));
  ok(ev.byN.get(2).date === "2026-08-01 10:00" && ev.byN.has(200) && ev.byN.size === earnedPsp.byN.size + 1, "3: achievements joined, the earlier date kept");
  eq(text(VITA, "EMBLEM/earned/ULUS10558.txt"), text(VAULT, "EMBLEM/earned/ULUS10558.txt"), "3: the Vita's file is the joined one");
  ok(/^ms0:\/ISO\/Ys Felghana \[Vita copy\]\.iso \| \d+ \| 0 \| 0 \| -1 \| 1\r$/m.test(text(VITA, "SHELF/games.txt")), "3: the favourite reaches the Vita's own path for the game");
  ok(has(VITA, "SYNC/STATE.JSON") && !has(VITA, "RUNTIME") && !has(VITA, "SIDEQUEST"), "3: no other device's logs or states arrive");
  r = await sync(VITA, VAULT, null);
  eq(r.P.items.length, 0, "3: the Vita is level: " + r.P.items.map((i) => i.kind + " " + i.key).join(", "));

  // 4. the PSP catches up with what the Vita brought
  r = await sync(PSP, VAULT, null, null, { now: "2026-11-27T12:00:00" });
  eq(acts(r.P, "save"), "ULUS10560SAVE00:toStick", "4: the Vita's Final Fantasy IV save comes to the PSP");
  ok(C.earnedRead(text(PSP, "EMBLEM/earned/ULUS10558.txt")).byN.has(200), "4: and its achievement");
  eq(+text(PSP, "CHECKPOINT/JOURNEY/ULUS10560.TIM"), ff4Before + 2500, "4: and its time");
  r = await sync(PSP, VAULT, null);
  eq(r.P.items.length, 0, "4: level again");

  // 5. play on the PSP: a save changes, a line is logged, an hour is played, a favourite is dropped
  save(PSP, "ULUS10558SAVE00", "Ys: The Oath in Felghana", "Elderm Mountains", "ys save 2", "2026-11-28T21:00:00");
  const t0 = +text(PSP, "CHECKPOINT/JOURNEY/ULUS10558.TIM");
  fs.appendFileSync(path.join(PSP, "CHECKPOINT/JOURNEY/ULUS10558.TXT"), `2026-11-28 21:00 | ${Math.floor((t0 + 3600) / 3600)}h ${String(Math.floor((t0 + 3600) / 60) % 60).padStart(2, "0")}m | Elderm Mountains | ULUS10558SAVE00\r\n`);
  put(PSP, "CHECKPOINT/JOURNEY/ULUS10558.TIM", (t0 + 3600) + "\n");
  put(PSP, "SHELF/games.txt", text(PSP, "SHELF/games.txt").replace(/(Ys - The Oath in Felghana \(Undub\)\.iso \| )\d+( \| 0 \| 0 \| -1 \| )1/, "$114200000$20"));
  r = await sync(PSP, VAULT, null, null, { now: "2026-11-28T22:00:00" });
  eq(acts(r.P, "save"), "ULUS10558SAVE00:toVault", "5: only the changed save moves");
  eq(r.P.items.find((i) => i.kind === "save").why, "changed", "5: because it changed here");
  eq(fs.readdirSync(path.join(VAULT, "SYNC/history/ULUS10558SAVE00")).length, 2, "5: the vault keeps the copy it had");
  // ... and on the Vita meanwhile: half an hour of the same game, without saving
  put(VITA, "CHECKPOINT/JOURNEY/ULUS10558.TIM", (t0 + 1800) + "\n");
  r = await sync(VITA, VAULT, null, null, { now: "2026-11-29T09:00:00" });
  eq(acts(r.P, "save"), "ULUS10558SAVE00:toStick", "5: the Vita takes the PSP's save without asking");
  ok(get(VITA, "psp/savedata/ULUS10558SAVE00/DATA.BIN").toString() === "ys save 2", "5: and has it");
  eq(+text(VITA, "CHECKPOINT/JOURNEY/ULUS10558.TIM"), t0 + 5400, "5: an hour there and half an hour here make an hour and a half");
  ok(text(VITA, "CHECKPOINT/JOURNEY/ULUS10558.TXT").includes("Elderm Mountains"), "5: the PSP's journey line is on the Vita");
  ok(/Ys Felghana \[Vita copy\]\.iso \| 14200000 \| 0 \| 0 \| -1 \| 0\r$/m.test(text(VITA, "SHELF/games.txt")), "5: dropped as a favourite on the Vita too, last started moved on");
  r = await sync(PSP, VAULT, null, null, { now: "2026-11-29T10:00:00" });
  eq(+text(PSP, "CHECKPOINT/JOURNEY/ULUS10558.TIM"), t0 + 5400, "5: the PSP gets the Vita's half hour");
  eq(acts(r.P, "save"), "", "5: and no save moves");

  // 5b. the Vita is pulled out while its play time is being written: the time is not counted twice
  {
    const tv = +text(VITA, "CHECKPOINT/JOURNEY/ULUS10558.TIM");
    put(VITA, "CHECKPOINT/JOURNEY/ULUS10558.TIM", (tv + 600) + "\n");          // ten minutes on the Vita
    put(PSP, "CHECKPOINT/JOURNEY/ULUS10558.TIM", (tv + 1200) + "\n");          // twenty on the PSP
    await sync(PSP, VAULT, null);
    r = await sync(VITA, VAULT, null, null, { dirs: (S) => { let n = 0; S.failOn = (p) => /ULUS10558\.TIM$/i.test(p) || (/STATE\.JSON$/.test(p) && n++ > 0); } });
    ok(r.R.failed.some((f) => f.kind === "journey") && r.R.stateError, "5b: the cut-short sync is reported");
    eq(+text(VITA, "CHECKPOINT/JOURNEY/ULUS10558.TIM"), tv + 600, "5b: the Vita's file is as it was");
    eq(JSON.parse(text(VAULT, "SYNC/VAULT.JSON")).tim.ULUS10558.total, tv + 1800, "5b: the vault has taken the ten minutes in");
    r = await sync(VITA, VAULT, null);
    eq(+text(VITA, "CHECKPOINT/JOURNEY/ULUS10558.TIM"), tv + 1800, "5b: synced again, the ten minutes are counted once");
    eq(+text(VAULT, "CHECKPOINT/JOURNEY/ULUS10558.TIM"), tv + 1800, "5b: in the vault's file too");
    // and when the page was closed just after the device's file was written (the vault still says "in progress")
    const ix = JSON.parse(text(VAULT, "SYNC/VAULT.JSON")), id = JSON.parse(text(VITA, "SYNC/STATE.JSON")).device.id;
    ix.tim.ULUS10558.at[id] = { from: tv + 600, to: tv + 1800 };
    put(VAULT, "SYNC/VAULT.JSON", JSON.stringify(ix));
    r = await sync(VITA, VAULT, null);
    eq(+text(VAULT, "CHECKPOINT/JOURNEY/ULUS10558.TIM"), tv + 1800, "5b: a write that did land is recognised");
    r = await sync(PSP, VAULT, null);
    eq(+text(PSP, "CHECKPOINT/JOURNEY/ULUS10558.TIM"), tv + 1800, "5b: all three agree");
  }

  // 6. both devices save the same game before either is synced: ask, and keep the loser
  save(PSP, "ULUS10512SAVE00", "Persona 3 Portable", "5/02 Tartarus", "p3p on the psp", "2026-12-01T20:00:00");
  save(VITA, "ULUS10512SAVE00", "Persona 3 Portable", "5/03 School", "p3p on the vita", "2026-12-02T08:00:00", "psp/savedata");
  r = await sync(PSP, VAULT, null, null, { now: "2026-12-02T09:00:00" });
  eq(acts(r.P, "save"), "ULUS10512SAVE00:toVault", "6: the first device to sync just sends its save");
  r = await sync(VITA, VAULT, null, (P) => {
    const it = P.items.find((i) => i.kind === "save");
    eq(it.action + " " + it.choice, "conflict stick", "6: the second is asked, and its own newer save is offered");
    eq(it.v.sfo.SAVEDATA_TITLE + " / " + it.s.sfo.SAVEDATA_TITLE, "5/02 Tartarus / 5/03 School", "6: with what each save says of itself");
  }, { now: "2026-12-02T09:30:00" });
  ok(get(VAULT, "PSP/SAVEDATA/ULUS10512SAVE00/DATA.BIN").toString() === "p3p on the vita", "6: the Vita's save is the vault's now");
  { const h = fs.readdirSync(path.join(VAULT, "SYNC/history/ULUS10512SAVE00")).map((d) => get(VAULT, `SYNC/history/ULUS10512SAVE00/${d}/DATA.BIN`).toString());
    ok(h.includes("p3p on the psp"), "6: the PSP's save is in the history: " + h.join(", ")); }
  // choosing Skip leaves both alone, and asks again next time
  save(PSP, "ULUS10512SAVE00", "Persona 3 Portable", "5/04 Dorm", "p3p psp again", "2026-12-03T20:00:00");
  r = await sync(PSP, VAULT, null, (P) => { const it = P.items.find((i) => i.kind === "save"); eq(it.action, "conflict", "6: the PSP's turn to be asked"); it.choice = "skip"; });
  ok(get(PSP, "PSP/SAVEDATA/ULUS10512SAVE00/DATA.BIN").toString() === "p3p psp again" && get(VAULT, "PSP/SAVEDATA/ULUS10512SAVE00/DATA.BIN").toString() === "p3p on the vita", "6: Skip touches neither");
  r = await sync(PSP, VAULT, null, (P) => { const it = P.items.find((i) => i.kind === "save"); eq(it && it.action, "conflict", "6: and it is asked again"); it.choice = "vault"; });
  ok(get(PSP, "PSP/SAVEDATA/ULUS10512SAVE00/DATA.BIN").toString() === "p3p on the vita", "6: taking the vault's");
  ok(fs.readdirSync(path.join(VAULT, "SYNC/history/ULUS10512SAVE00")).some((d) => get(VAULT, `SYNC/history/ULUS10512SAVE00/${d}/DATA.BIN`).toString() === "p3p psp again"), "6: keeps what the PSP had");

  // 7. a save removed on a device is not put back unasked, and not removed anywhere else
  fs.rmSync(path.join(VITA, "psp/savedata/ULUS10558SYS"), { recursive: true });
  r = await sync(VITA, VAULT, null);
  eq(acts(r.P, "save"), "ULUS10558SYS:gone", "7: seen as removed here");
  ok(!r.P.items[0].on && !has(VITA, "psp/savedata/ULUS10558SYS") && has(VAULT, "PSP/SAVEDATA/ULUS10558SYS/DATA.BIN"), "7: left as it is on both sides");
  r = await sync(VITA, VAULT, null, (P) => { P.items.find((i) => i.action === "gone").on = true; });
  ok(has(VITA, "psp/savedata/ULUS10558SYS/DATA.BIN"), "7: put back when asked");
  // a file added to and one removed from a save folder
  put(PSP, "PSP/SAVEDATA/ULUS10558SAVE00/EXTRA.BIN", "more", "2026-12-05T10:00:00");
  fs.rmSync(path.join(PSP, "PSP/SAVEDATA/ULUS10558SAVE00/ICON0.PNG"));
  await sync(PSP, VAULT, null);
  await sync(VITA, VAULT, null);
  ok(has(VITA, "psp/savedata/ULUS10558SAVE00/EXTRA.BIN") && !has(VITA, "psp/savedata/ULUS10558SAVE00/ICON0.PNG"), "7: a save's files are matched, added and removed");

  // 8. a save changed between Compare and Sync is not copied
  save(PSP, "ULUS10515SAVE00", "Valkyria Chronicles 2", "Stage 4", "jda 1", "2026-12-06T10:00:00");
  r = await sync(PSP, VAULT, null, null, { before: () => put(PSP, "PSP/SAVEDATA/ULUS10515SAVE00/DATA.BIN", "jda 2") });
  ok(r.R.failed.length === 1 && /changed after Compare/.test(r.R.failed[0].error) && !has(VAULT, "PSP/SAVEDATA/ULUS10515SAVE00"), "8: refused, and the vault has no half of it");
  r = await sync(PSP, VAULT, null);
  ok(r.R.failed.length === 0 && get(VAULT, "PSP/SAVEDATA/ULUS10515SAVE00/DATA.BIN").toString() === "jda 2", "8: the next sync takes it");

  // 9. a sync cut short while a save is being written to the device
  save(PSP, "ULUS10515SAVE00", "Valkyria Chronicles 2", "Stage 5", "jda 3", "2026-12-07T10:00:00");
  await sync(PSP, VAULT, null);
  await sync(VITA, VAULT, null);                                   // the Vita has "jda 3"
  save(PSP, "ULUS10515SAVE00", "Valkyria Chronicles 2", "Stage 6", "jda 4", "2026-12-08T10:00:00");
  await sync(PSP, VAULT, null);
  r = await sync(VITA, VAULT, null, null, { dirs: (S) => { S.failOn = (p) => /ULUS10515SAVE00\/ICON0\.PNG$/i.test(p); } });
  ok(r.R.failed.length === 1 && r.R.failed[0].key === "ULUS10515SAVE00", "9: the copy is reported as failed");
  ok(JSON.parse(text(VITA, "SYNC/STATE.JSON")).pending.includes("ULUS10515SAVE00"), "9: the device remembers which save is not whole");
  ok(fs.readdirSync(path.join(VAULT, "SYNC/history/ULUS10515SAVE00")).some((d) => get(VAULT, `SYNC/history/ULUS10515SAVE00/${d}/DATA.BIN`).toString() === "jda 3"), "9: what the Vita had is in the history");
  r = await sync(VITA, VAULT, null, (P) => {
    const it = P.items.find((i) => i.key === "ULUS10515SAVE00");
    ok(it && it.action === "conflict" && it.choice === "vault" && it.cut, "9: the next Compare offers the vault's whole copy, not the half-written one");
  });
  ok(get(VITA, "psp/savedata/ULUS10515SAVE00/DATA.BIN").toString() === "jda 4" && get(VITA, "psp/savedata/ULUS10515SAVE00/ICON0.PNG").toString() === "icon of Valkyria Chronicles 2", "9: and the save is whole again");
  ok(!JSON.parse(text(VITA, "SYNC/STATE.JSON")).pending, "9: nothing left pending");
  ok(get(VAULT, "PSP/SAVEDATA/ULUS10515SAVE00/DATA.BIN").toString() === "jda 4", "9: the vault's copy was never touched");

  // 9b. a Memory Stick that cannot be written to: the sync stops before anything changes
  {
    save(PSP, "ULUS10515SAVE00", "Valkyria Chronicles 2", "Stage 7", "jda 5", "2026-12-09T10:00:00");
    const S = new NodeDir(PSP), V = new NodeDir(VAULT);
    S.failOn = () => true;
    const P = C.plan(await C.scan(S, "stick"), await C.scan(V, "vault"));
    let said = "";
    try { await C.apply(P, S, V, {}); } catch (e) { said = e.message; }
    ok(/cannot be written to, so nothing was changed/.test(said) && get(VAULT, "PSP/SAVEDATA/ULUS10515SAVE00/DATA.BIN").toString() === "jda 4", "9b: refused, and the vault is as it was");
    await sync(PSP, VAULT, null);
  }

  // 10. the history keeps the last few copies only
  for (let i = 0; i < C.KEEP + 3; i++) {
    save(PSP, "ULUS10558SYS", "Ys: The Oath in Felghana", "System", "sys " + i, `2026-12-1${i}T10:00:00`);
    await sync(PSP, VAULT, null, null, { now: `2026-12-1${i}T11:00:00` });
  }
  eq(fs.readdirSync(path.join(VAULT, "SYNC/history/ULUS10558SYS")).length, C.KEEP, "10: the history is trimmed");
  ok(get(VAULT, "PSP/SAVEDATA/ULUS10558SYS/DATA.BIN").toString() === "sys " + (C.KEEP + 2), "10: the vault has the newest");

  // 11. Emblem game files move like saves
  put(PSP, "EMBLEM/games/ULUS10558.txt", text(PSP, "EMBLEM/games/ULUS10558.txt") + "\r\n# edited in the Workshop\r\n", "2026-12-20T10:00:00");
  put(PSP, "EMBLEM/games/NPJH50342.txt", "game NPJH50342\r\n", "2026-12-20T10:00:00");
  r = await sync(PSP, VAULT, null);
  eq(acts(r.P, "emblem"), "NPJH50342:toVault ULUS10558:toVault", "11: an edited and a new game file go to the vault");
  ok(fs.readdirSync(path.join(VAULT, "SYNC/history/EMBLEM_ULUS10558")).length === 1, "11: the one replaced is kept");
  r = await sync(VITA, VAULT, null);
  eq(acts(r.P, "emblem").includes("NPJH50342:toStick") && text(VITA, "EMBLEM/games/ULUS10558.txt").includes("edited in the Workshop"), true, "11: and on to the Vita");

  // 12. a second vault: nothing is overwritten without asking
  const VAULT2 = path.join(TMP, "vault2"); fs.mkdirSync(VAULT2);
  save(path.join(TMP, "other"), "ULUS10558SAVE00", "Ys: The Oath in Felghana", "Elsewhere", "ys from elsewhere", "2026-12-25T10:00:00");
  await sync(path.join(TMP, "other"), VAULT2, "Other");
  const timVault2 = has(VAULT2, "CHECKPOINT/JOURNEY/ULUS10558.TIM");
  r = await sync(PSP, VAULT2, null, (P) => {
    ok(P.warnings.some((w) => /different vault/.test(w)), "12: the page says the vault is another one");
    eq(P.items.find((i) => i.key === "ULUS10558SAVE00").action, "conflict", "12: a save that differs is asked about");
    for (const i of P.items) if (i.action === "conflict") i.choice = "skip";
  });
  ok(!timVault2 && get(PSP, "PSP/SAVEDATA/ULUS10558SAVE00/DATA.BIN").toString() === "ys save 2", "12: and skipped means untouched");
  r = await sync(PSP, VAULT, null, (P) => {       // back at the first vault: it no longer counts as synced with it
    ok(P.items.filter((i) => i.kind === "save").every((i) => i.action !== "toStick" || !i.s), "12: back at the first vault, no save on the device is replaced unasked");
    for (const i of P.items) if (i.action === "conflict") i.choice = "skip";
  });

  // 12b. what must never be mistaken for a missing save, and what file managers leave behind
  {
    const A = path.join(TMP, "a"), VA = path.join(TMP, "va"); fs.mkdirSync(VA);
    save(A, "ULUS10558SAVE00", "Ys", "Redmont", "small", "2026-01-01T10:00:00");
    put(VA, ".directory", "[Dolphin]\n");                                   // a new vault that a file manager has looked at
    r = await sync(A, VA, "A");
    ok(r.R && r.R.failed.length === 0, "12b: a hidden file in the new vault folder does not stop it: " + r.P.errors.join());
    put(VA, "PSP/SAVEDATA/ULUS10558SAVE00/.directory", "[Dolphin]\n");
    put(VA, "PSP/SAVEDATA/ULUS10558SAVE00/Thumbs.db", "x");
    r = await sync(A, VA, null);
    eq(r.P.items.length, 0, "12b: files a file manager left in a save folder change nothing");
    // on another device the same save folder has grown past what a save is
    const B = path.join(TMP, "b");
    put(B, "PSP/SAVEDATA/ULUS10558SAVE00/INSTALL.DAT", Buffer.alloc(C.BIG + 10));
    put(B, "PSP/SAVEDATA/ULUS10558SAVE00/DATA.BIN", "mine");
    r = await sync(B, VA, "B");
    eq(acts(r.P, "save"), "", "12b: a folder too large to read is not taken for a missing save");
    ok(get(B, "PSP/SAVEDATA/ULUS10558SAVE00/DATA.BIN").toString() === "mine" && has(B, "PSP/SAVEDATA/ULUS10558SAVE00/INSTALL.DAT"), "12b: and nothing in it is touched");
    // a folder added between two compares is seen by the same folder object
    const S = new NodeDir(A), V = new NodeDir(VA);
    await C.scan(S, "stick");
    save(A, "ULUS10512SAVE00", "P3P", "Dorm", "new", "2026-01-02T10:00:00");
    eq(acts(C.plan(await C.scan(S, "stick"), await C.scan(V, "vault")), "save"), "ULUS10512SAVE00:toVault", "12b: a save made since the last Compare is found");
  }

  // 13. the same in memory, as the page's sample does it
  {
    const S = new MemDir("stick"), V = new MemDir("vault");
    S.put("PSP/SAVEDATA/ULUS10558SAVE00/PARAM.SFO", C.sfoWrite({ TITLE: "Ys", SAVEDATA_TITLE: "Redmont" }), 1000);
    S.put("PSP/SAVEDATA/ULUS10558SAVE00/DATA.BIN", "abc", 1000);
    S.put("EMBLEM/earned/ULUS10558.txt", "1 | 2026-01-01 10:00 | A | 5 pts\r\n", 1000);
    S.put("CHECKPOINT/JOURNEY/ULUS10558.TIM", "120\n", 1000);
    let P = C.plan(await C.scan(S, "stick"), await C.scan(V, "vault"));
    eq(P.items.map((i) => i.kind).join(), "save,earned,journey", "13: in memory, the plan");
    const R = await C.apply(P, S, V, { deviceName: "Mem" });
    eq(R.failed.length, 0, "13: applied");
    ok(V.files.has("PSP/SAVEDATA/ULUS10558SAVE00/DATA.BIN") && V.files.has("SYNC/VAULT.JSON") && S.files.has("SYNC/STATE.JSON"), "13: files where they belong");
    P = C.plan(await C.scan(S, "stick"), await C.scan(V, "vault"));
    eq(P.items.length, 0, "13: level");
    // a PS Vita's card: the Memory Stick is its pspemu folder
    const card = new MemDir("card");
    card.put("pspemu/PSP/SAVEDATA/ULUS10558SAVE00/DATA.BIN", "zzz", 500);
    P = C.plan(await C.scan(card.sub("pspemu", "pspemu"), "stick"), await C.scan(V, "vault"));
    eq(acts(P, "save"), "ULUS10558SAVE00:conflict", "13: a sub-folder as the Memory Stick");
  }

  // 14. a stick without Shelf or the plugins gets saves only
  {
    const bare = path.join(TMP, "bare");
    save(bare, "ULUS10560SAVE00", "Final Fantasy IV", "Baron", "old ff4", "2026-01-01T10:00:00");
    r = await sync(bare, VAULT, "Bare", (P) => { for (const i of P.items) if (i.action === "conflict") i.choice = "vault"; });
    ok(!has(bare, "EMBLEM") && !has(bare, "CHECKPOINT") && !has(bare, "SHELF") && has(bare, "PSP/SAVEDATA/ULUS10558SAVE00/DATA.BIN"), "14: no plugin folders are made on a device that has none");
  }

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`sync: ${pass} checks passed` + (fail ? `, ${fail} FAILED` : ""));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
