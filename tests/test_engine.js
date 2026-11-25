// Prints, for each game file, what tests/native_driver.c prints: the JavaScript engine
// must give the same lines as em.c built natively.
const fs = require("fs"), path = require("path");
const { engine } = require("./node_stick.js");
const e = engine();
for (const file of process.argv.slice(2)) {
  const text = fs.readFileSync(file, "latin1");
  const r = e.check(Buffer.from(text, "latin1").toString("utf8"));
  let out = `== ${path.basename(file)}\n`;
  for (const x of r.errors) out += `E\t${x.line}\t${x.msg}\t${x.text}\n`;
  out += `G\t${r.game}\t${r.title}\n`;
  for (const a of r.ach) out += `A\t${a.n}\t${a.points}\t${+a.included}\t${+a.timed}\t${+a.gated}\t${a.title}\n`;
  const L = r.limits;
  out += `L\t${L.nodes}\t${L.addrs}\t${L.snaps}\t${L.runs}\t${L.defs}\t${L.show}\t${+r.hasReady}\t${r.errors.length}\t${r.total}\t${r.lines}\n`;
  for (const fill of [0, 255]) {
    const m = e.run(Buffer.from(text, "latin1").toString("utf8"), { fill }, 3);
    for (const id of m.fired) out += `F ${fill} ${id}\n`;
    out += `M ${fill} ${+m.readyHeld} ${m.fired.length}\n`;
  }
  process.stdout.write(out);
}
