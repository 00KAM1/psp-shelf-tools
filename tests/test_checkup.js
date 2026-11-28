// Checkup: the sample's setup with its faults, a setup with nothing wrong, and each fault
// on its own, on Memory Sticks made up in memory. With --releases <folder of release zips>
// it also checks the real files of every release against data/official.json.
const fs = require("fs"), path = require("path");
const C = require("../src/checkup.js"), S = require("../src/stick.js"), NS = require("./node_stick.js");
let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) pass++; else { fail++; console.log("FAIL", what); } };
const eq = (a, b, what) => ok(a === b, `${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const official = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/official.json")));
const extra = JSON.parse(fs.readFileSync(path.join(__dirname, "sample/official.json")));
const enc = (s) => (typeof s === "string" ? new TextEncoder().encode(s) : s);
const stick = (files, label) => S.fromEntries(Object.entries(files).map(([p, v]) => { const b = enc(v); return { path: p, size: b.length, mtime: new Date(), read: async (s, e) => b.slice(s, e) }; }), label || "stick");
const prx = (name, v, built, more) => enc("\x7fELF" + "\0".repeat(28) + `${name} ${v}\0${name} ${v} (built ${built}) start\0` + (more || ""));
const pbp = (v, built) => enc("\0PBP" + "\0".repeat(36) + `Shelf ${v}\0Shelf ${v} (built ${built}) from %s\0`);
const state = (version, when) => { const b = new Uint8Array(404); new DataView(b.buffer).setUint32(0, 0x31535153, true); new DataView(b.buffer).setUint32(4, version, true); b.set(enc("Ys"), 100); b.set(enc("ULUS10558"), 228); b.set(enc(when), 244); return b; };
const card = (r, id) => r.cards.find((c) => c.id === id);
const notes = (r, id, level) => card(r, id).notes.filter((n) => !level || n.level === level).map((n) => n.text).join(" | ");
const B = "Nov 24 2026 13:29:00";
// a setup with nothing wrong, to change one thing at a time
const good = () => ({
  "SEPLUGINS/sidequest.prx": prx("Sidequest", "9.0", B), "SEPLUGINS/checkpoint.prx": prx("Checkpoint", "9.0", B),
  "SEPLUGINS/emblem.prx": prx("Emblem", "9.0", B), "SEPLUGINS/scanline.prx": prx("Scanline", "9.0", B), "SEPLUGINS/runtime.prx": prx("Runtime", "9.0", B),
  "SEPLUGINS/PLUGINS.TXT": "# mine\r\ngame, ms0:/SEPLUGINS/sidequest.prx, on\r\ngame, ms0:/SEPLUGINS/checkpoint.prx, on\r\ngame, ms0:/SEPLUGINS/emblem.prx, on\r\ngame, ms0:/SEPLUGINS/scanline.prx, on\r\nalways, ms0:/SEPLUGINS/runtime.prx, on\r\n",
  "PSP/SAVEDATA/ARK_01234/SETTINGS.TXT": "always, usbcharge, on\r\nalways, highmem, off\r\nalways, launcher, on\r\n",
  "PSP/SAVEDATA/ARK_01234/VBOOT.PBP": pbp("9.0", B), "PSP/GAME/SHELF/EBOOT.PBP": pbp("9.0", B),
  "EMBLEM/games/ULUS10558.txt": "game ULUS10558\r\n", "SIDEQUEST/ULUS10558/STATE1.SQS": state(5, "2026-11-25 20:00"),
  "SIDEQUEST/sidequest.log": `Sidequest 9.0 (built ${B}) start: model=8\r\n`,
});
// its files are "from a release": a list made for them
const listOf = async (files) => ({ files: await Promise.all(Object.entries(files).filter(([p]) => /\.(prx|PBP)$/.test(p)).map(async ([p, v]) => {
  const h = [...new Uint8Array(await require("crypto").webcrypto.subtle.digest("SHA-256", enc(v)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const i = C.readInside(enc(v)); return { name: i.name.toLowerCase(), platform: i.vita ? "vita" : "psp", version: i.version, built: i.built, sha256: h, size: enc(v).length, release: "2026-11-25" }; })) });

(async () => {
  // ---- reading a file ----------------------------------------------------------------------
  let i = C.readInside(prx("Scanline", "1.2", "Nov 24 2026 13:29:05"));
  ok(i.name === "Scanline" && i.version === "1.2" && !i.vita && i.built === "Nov 24 2026 13:29:05", "name, version and build are read");
  i = C.readInside(enc("\x7fELF Sidequest 1.3\0Sidequest 1.0 Vita\0Sidequest 1.0 Vita TEST\0Emblem\0(built Nov 26 2026 07:33:19)"));
  ok(i.name === "Sidequest" && i.version === "1.0" && i.vita, "a PS Vita build is told by its own line, not by a PSP line left in it");
  eq(C.readInside(enc("\x7fELF nothing here")), null, "a file with no version");
  ok(C.builtTime("Nov  4 2026 03:05:09") === new Date(2026, 10, 4, 3, 5, 9).getTime() && C.builtTime("x") === 0, "the build date as a time");
  const al = C.arkLines("# c\r\n; c\r\n// c\r\n\r\ngame, ms0:/SEPLUGINS/a.prx, on\r\nalways , ms0:/x/b.prx , OFF\r\nULUS10558, highmem, 1\r\nbroken line\r\n");
  ok(al.length === 4 && al[0].where === "game" && al[0].on && !al[1].on && al[1].what === "ms0:/x/b.prx" && al[2].on && al[3].odd && al[3].n === 8, "ARK's lines: comments skipped, on and off, a line that is not one");

  // ---- the list of releases ------------------------------------------------------------------
  eq(C.newest(official.files, "sidequest", "psp").version, "1.3", "newest Sidequest for the PSP");
  eq(C.newest(official.files, "shelf", "psp").release, "2026-11-26", "newest Shelf for the PSP");
  ok(C.newest(official.files, "emblem", "vita").version === "1.0" && C.newest(official.files, "nothing", "psp") === null, "newest for the PS Vita; none for a name not in it");
  ok(official.files.every((e) => /^[0-9a-f]{64}$/.test(e.sha256) && e.size > 0 && e.built && /^(psp|vita)$/.test(e.platform)) && new Set(official.files.map((e) => e.sha256)).size === official.files.length, "every entry is whole and listed once");

  // ---- the sample --------------------------------------------------------------------------------
  let r = await C.run(NS.fromDir(path.join(__dirname, "sample/ms0")), official, { sample: true, extra, version: "t" });
  eq(r.cards.map((c) => c.id + ":" + c.status).join(" "), "sidequest:ok checkpoint:ok emblem:warn scanline:ok runtime:warn shelf:ok ark:bad states:bad", "sample: each card's verdict");
  ok(r.counts.bad === 2 && r.counts.warn === 2 && r.platform === "psp" && r.found, "sample: counts " + JSON.stringify(r.counts));
  ok(/Emblem 1\.2 is out \(release 2026-11-25\)/.test(notes(r, "emblem")), "sample: Emblem is a release behind");
  ok(/^Delete your 6 Sidequest states and suspends before updating/.test(card(r, "emblem").notes.find((n) => n.update).fix), "sample: with states on the Memory Stick, the update asks for them to be deleted first");
  ok(card(r, "sidequest").version === "1.3" && card(r, "sidequest").facts.includes("From release 2026-11-25"), "sample: Sidequest is from its release");
  ok(/switched off/.test(notes(r, "scanline", "info")) && /last ran as Scanline 1\.0/.test(notes(r, "scanline")), "sample: Scanline is off, and last ran as an older one");
  ok(/has to say "always"/.test(notes(r, "runtime")) && card(r, "runtime").notes[0].code === "always, ms0:/SEPLUGINS/runtime.prx, on", "sample: Runtime's line, and the line to use");
  ok(/Extra memory is on/.test(notes(r, "ark", "bad")) && /pocketclock\.prx/.test(notes(r, "ark", "info")), "sample: extra memory, and someone else's plugin");
  ok(/6 states were saved before/.test(notes(r, "states", "bad")) && /Shelf 1\.2/.test(notes(r, "states")) && r.text.includes("Sidequest's states: delete these"), "sample: states older than what is installed are a fault, not a hint");
  ok(card(r, "shelf").facts.includes("Launcher copy matches") && card(r, "shelf").facts.includes("Starts at power on") && card(r, "shelf").facts.some((f) => /games in its library/.test(f)), "sample: Shelf's facts");
  ok(r.text.startsWith("Shelf Tools Checkup t (PSP builds)") && r.text.includes("[!!] Extra memory is on") && r.text.includes("always, ms0:/SEPLUGINS/runtime.prx, on"), "sample: the report as text");
  // without the sample's own list, its stand-ins are not files from a release
  r = await C.run(NS.fromDir(path.join(__dirname, "sample/ms0")), official, {});
  ok(/not a file from a release/.test(notes(r, "sidequest", "warn")), "a file that is in no release is said to be so");

  // ---- nothing wrong -------------------------------------------------------------------------------
  let f = good(), T = await listOf(f);
  r = await C.run(stick(f), T, {});
  ok(r.counts.bad === 0 && r.counts.warn === 0 && r.cards.every((c) => c.status === "ok"), "a good setup: no problem found: " + r.text);
  eq(notes(r, "sidequest") + notes(r, "ark") + notes(r, "states") + notes(r, "shelf"), "", "a good setup: nothing to say");

  // ---- one fault at a time ---------------------------------------------------------------------------
  const one = async (change, opts, table) => { const g = good(); const t = table || T; change(g); return C.run(stick(g, opts && opts.label), t, opts || {}); };
  r = await one((g) => { delete g["SEPLUGINS/emblem.prx"]; });
  ok(card(r, "emblem").status === "bad" && /lists ms0:\/SEPLUGINS\/emblem\.prx, but that file is not/.test(notes(r, "emblem")), "listed, but the file is missing");
  r = await one((g) => { g["SEPLUGINS/PLUGINS.TXT"] = g["SEPLUGINS/PLUGINS.TXT"].replace(/game, ms0:\/SEPLUGINS\/emblem.*\r\n/, ""); });
  ok(card(r, "emblem").status === "warn" && card(r, "emblem").notes[0].code === "game, ms0:/SEPLUGINS/emblem.prx, on", "installed, but not listed: the line to add");
  r = await one((g) => { delete g["SEPLUGINS/PLUGINS.TXT"]; });
  ok(card(r, "emblem").status === "bad" && /No PLUGINS\.TXT was found/.test(notes(r, "ark", "bad")), "no PLUGINS.TXT at all");
  r = await one((g) => { for (const k of Object.keys(g)) if (/sidequest|SIDEQUEST/.test(k)) delete g[k]; g["SEPLUGINS/PLUGINS.TXT"] = g["SEPLUGINS/PLUGINS.TXT"].replace(/.*sidequest.*\r\n/, ""); });
  ok(card(r, "sidequest").status === "none" && card(r, "states").status === "none" && r.counts.bad === 0, "a plugin that is not installed is no fault");
  r = await one((g) => { g["PSP/SAVEDATA/ARK_01234/PLUGINS.TXT"] = "game, ms0:/SEPLUGINS/checkpoint.prx, on\r\n"; });
  ok(/listed and switched on 2 times/.test(notes(r, "checkpoint", "warn")), "the same plugin on in both of ARK's lists");
  r = await one((g) => { g["SEPLUGINS/emblem.prx"] = g["SEPLUGINS/scanline.prx"]; });
  ok(/is Scanline 9\.0, not Emblem/.test(notes(r, "emblem", "bad")), "a file under another plugin's name");
  r = await one((g) => { g["SEPLUGINS/emblem.prx"] = enc("<html>404"); });
  ok(/does not look like a plugin file/.test(notes(r, "emblem", "bad")), "a file that is not a plugin");
  r = await one((g) => { g["SEPLUGINS/emblem.prx"] = prx("Emblem", "9.0", B, "changed"); });
  ok(card(r, "emblem").status === "warn" && /not a file from a release/.test(notes(r, "emblem")) && card(r, "emblem").version === "9.0", "a changed file: its version is still read");
  r = await one(() => {}, {}, { files: T.files.concat([{ name: "emblem", platform: "psp", version: "9.1", built: "x", sha256: "0".repeat(64), size: 1, release: "2026-12-01" }]) });
  ok(/Emblem 9\.1 is out \(release 2026-12-01\)/.test(notes(r, "emblem", "warn")) && card(r, "emblem").notes[0].link === "https://github.com/00KAM1/psp-ark-plugins/releases", "a newer release, with where to get it");
  ok(/^Delete your 1 Sidequest state or suspend before updating/.test(card(r, "emblem").notes[0].fix), "one state: asked to delete it before the update");
  const newSq = { files: T.files.concat([{ name: "sidequest", platform: "psp", version: "9.1", built: "x", sha256: "1".repeat(64), size: 1, release: "2026-12-01" }]) };
  r = await one(() => {}, {}, newSq);
  ok(/Sidequest 9\.1 is out/.test(notes(r, "sidequest", "warn")) && /^Delete your 1 Sidequest state/.test(card(r, "sidequest").notes[0].fix), "a Sidequest update with a state: delete it first");
  r = await one((g) => { delete g["SIDEQUEST/ULUS10558/STATE1.SQS"]; }, {}, newSq);
  ok(/Sidequest 9\.1 is out/.test(notes(r, "sidequest", "warn")) && card(r, "sidequest").notes[0].fix === undefined, "a Sidequest update with no states: nothing to delete, nothing asked");
  r = await one((g) => { g["SEPLUGINS/PLUGINS.TXT"] += "nonsense\r\ngame, ms0:/SEPLUGINS/other.prx, off\r\n"; });
  ok(/1 line ARK cannot read \(line 7\)/.test(notes(r, "ark", "warn")) && /other\.prx \(off\)/.test(notes(r, "ark", "info")), "a line ARK cannot read; another plugin, off");
  r = await one((g) => { g["PSP/SAVEDATA/ARK_01234/SETTINGS.TXT"] = "always, highmem:auto, on\r\nms0:/ISO/x.iso, highmem, on\r\n"; });
  ok(card(r, "ark").status === "bad" && /highmem:auto/.test(notes(r, "ark", "bad")) && /on for 1 game/.test(notes(r, "ark", "info")), "extra memory in any of its forms, and for one game");
  r = await one((g) => { g["PSP/SAVEDATA/ARK_01234/SETTINGS.TXT"] = "always, highmem, on\r\n"; g["SEPLUGINS/PLUGINS.TXT"] = g["SEPLUGINS/PLUGINS.TXT"].replace("sidequest.prx, on", "sidequest.prx, off"); });
  ok(card(r, "ark").status === "ok" && card(r, "ark").facts.includes("Extra memory on"), "extra memory is no fault with Sidequest off");
  r = await one((g) => { g["PSP/SAVEDATA/ARK_01234/VBOOT.PBP"] = pbp("8.0", "Nov 20 2026 10:00:00"); });
  ok(/VBOOT\.PBP\) is Shelf 8\.0.*Game menu is Shelf 9\.0/.test(notes(r, "shelf", "warn")), "Shelf's launcher copy is an older Shelf");
  r = await one((g) => { g["PSP/SAVEDATA/ARK_01234/VBOOT.PBP"] = enc("\0PBP another launcher"); });
  ok(card(r, "shelf").status === "ok" && /another launcher/.test(notes(r, "shelf", "info")), "ARK's launcher is not Shelf");
  r = await one((g) => { delete g["SEPLUGINS/runtime.prx"]; g["SEPLUGINS/PLUGINS.TXT"] = g["SEPLUGINS/PLUGINS.TXT"].replace(/.*runtime.*\r\n/, ""); });
  ok(/Runtime is not installed/.test(notes(r, "shelf", "info")) && card(r, "runtime").status === "none", "Shelf without Runtime");
  r = await one((g) => { delete g["PSP/GAME/SHELF/EBOOT.PBP"]; delete g["PSP/SAVEDATA/ARK_01234/VBOOT.PBP"]; });
  ok(card(r, "shelf").status === "none" && /Shelf is not installed/.test(notes(r, "runtime", "info")), "Runtime without Shelf");
  r = await one((g) => { g["SIDEQUEST/ULUS10558/STATE2.SQS"] = state(4, "2026-11-25 21:00"); g["SIDEQUEST/ULUS10558/SUSPEND.SQS"] = enc("cut short"); });
  ok(card(r, "states").status === "bad" && /1 state is from before Sidequest 1\.1/.test(notes(r, "states", "bad")) && /not a whole state/.test(notes(r, "states", "warn")), "a state from an old Sidequest; a file cut short");
  r = await one((g) => { g["SIDEQUEST/ULUS10558/STATE1.SQS"] = state(5, "2026-11-20 20:00"); g["SIDEQUEST/ULUS10558/STATE2.SQS"] = state(5, "2026-11-24 09:00"); });
  ok(/1 state was saved before what is installed now was built/.test(notes(r, "states", "bad")) && card(r, "states").status === "bad", "a state days older than the build; one from the same day is given the doubt");
  r = await one((g) => { delete g["EMBLEM/games/ULUS10558.txt"]; });
  ok(/No game files were found/.test(notes(r, "emblem", "warn")), "Emblem with no game files");
  r = await one((g) => { g["SIDEQUEST/sidequest.log"] = "Sidequest 8.0 (built Nov 20 2026 10:00:00) start\r\n"; });
  ok(/last ran as Sidequest 8\.0/.test(notes(r, "sidequest", "info")) && card(r, "sidequest").status === "ok", "the log shows an older one ran last");
  r = await one((g) => { const b = new Uint8Array(16); new DataView(b.buffer).setUint32(0, 0x42494c53, true); g["SHELF/CACHE/LIBRARY.BIN"] = b; });
  ok(/library is empty/.test(notes(r, "shelf", "warn")), "Shelf found no games");

  // ---- PSP and PS Vita builds ---------------------------------------------------------------------------
  const vitaSet = () => { const g = good(); for (const k of Object.keys(g)) if (/\.prx$/.test(k)) { const n = C.readInside(g[k]).name; g[k.replace("SEPLUGINS", "seplugins")] = prx(n, "1.0 Vita", "Nov 25 2026 13:14:35"); delete g[k]; }
    g["seplugins/plugins.txt"] = g["SEPLUGINS/PLUGINS.TXT"].replace(/SEPLUGINS/g, "seplugins"); delete g["SEPLUGINS/PLUGINS.TXT"];
    g["PSP/GAME/SHELF/EBOOT.PBP"] = g["PSP/SAVEDATA/ARK_01234/VBOOT.PBP"] = pbp("1.0 Vita", "Nov 26 2026 09:15:00"); return g; };
  f = vitaSet(); r = await C.run(stick(f, "pspemu"), await listOf(f), { label: "pspemu" });
  ok(r.platform === "vita" && r.counts.bad === 0 && r.counts.warn === 0 && card(r, "sidequest").version === "1.0 Vita", "a PS Vita setup, lower-case folders: nothing wrong: " + r.text);
  f = vitaSet(); f["seplugins/emblem.prx"] = prx("Emblem", "9.0", B); r = await C.run(stick(f), await listOf(f), {});
  ok(/This is the PSP build; the rest of what is installed is the PS Vita one/.test(notes(r, "emblem", "bad")) && card(r, "emblem").notes.some((n) => n.link === "https://github.com/00KAM1/psvita-ark-plugins/releases"), "one PSP build among PS Vita ones");
  f = vitaSet(); f["seplugins/emblem.prx"] = prx("Emblem", "9.0", B); delete f["seplugins/plugins.txt"]; f["seplugins/PLUGINS.TXT"] = "game, ms0:/seplugins/sidequest.prx, on\r\n"; r = await C.run(stick(f), await listOf(f), {});
  eq(card(r, "emblem").notes.find((n) => n.code).code, "game, ms0:/seplugins/emblem.prx, on", "the line to add keeps the folder's own name");
  r = await one(() => {}, { label: "pspemu" });
  ok(r.cards.filter((c) => c.version).every((c) => /PS Vita's pspemu/.test(notes(r, c.id, "warn"))), "PSP builds in a PS Vita's pspemu folder");

  // ---- nothing to check ------------------------------------------------------------------------------
  r = await C.run(stick({ "CHECKPOINT/JOURNEY/ULUS10558.TIM": "60\n" }), official, {});
  ok(!r.found && r.cards.every((c) => c.status === "none"), "a zip of the data folders alone: nothing installed was seen");

  // ---- the real files of every release (optional) -------------------------------------------------------
  const at = process.argv.indexOf("--releases");
  if (at > 0) {
    const { execFileSync } = require("child_process");
    const out = execFileSync("python3", ["-I", "-c", `
import sys, zipfile, hashlib, os, re, json
rows = []
for n in sorted(os.listdir(sys.argv[1])):
    if not n.endswith(".zip"): continue
    z = zipfile.ZipFile(os.path.join(sys.argv[1], n))
    for i in z.infolist():
        if re.search(r"\\.(prx|pbp)$", i.filename, re.I):
            d = z.read(i); rows.append([n, i.filename, hashlib.sha256(d).hexdigest(), d.hex()])
print(json.dumps(rows))`, process.argv[at + 1]], { maxBuffer: 1 << 28 });
    let n = 0;
    for (const [zip, name, sha, hex] of JSON.parse(out)) {
      const e = official.files.find((x) => x.sha256 === sha), ins = C.readInside(Uint8Array.from(Buffer.from(hex, "hex")));
      ok(e && ins && ins.name.toLowerCase() === e.name && ins.version === e.version && ins.built === e.built && (ins.vita ? "vita" : "psp") === e.platform, `${zip} ${name}: read as ${ins && ins.name} ${ins && ins.version}, listed as ${e && e.name} ${e && e.version}`);
      n++;
    }
    console.log(`  ${n} files from the release zips read and found in the list`);
  }

  console.log(`checkup: ${pass} checks passed` + (fail ? `, ${fail} FAILED` : ""));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
