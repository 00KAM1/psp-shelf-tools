// Node: a folder on disk as a Stick (the same interface the page builds from a picked folder)
const fs = require("fs"), path = require("path");
const S = require("../src/stick.js");
function fromDir(dir, sizes) {
  const list = [];
  const walk = (d, rel) => {
    for (const n of fs.readdirSync(d)) {
      const full = path.join(d, n), r = rel ? rel + "/" + n : n;
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full, r);
      else list.push({ path: "stick/" + r, size: (sizes && sizes[r]) || st.size, mtime: st.mtime,
        read: async (s, e) => { const b = fs.readFileSync(full); return new Uint8Array(b.buffer, b.byteOffset, b.length).slice(s, e); } });
    }
  };
  walk(dir, "");
  return S.fromEntries(list, path.basename(dir));
}
function sampleSizes() {
  const out = {};
  for (const l of fs.readFileSync(path.join(__dirname, "sample/sizes.txt"), "utf8").split("\n")) { const i = l.lastIndexOf(" "); if (i > 0) out[l.slice(0, i)] = +l.slice(i + 1); }
  return out;
}
function engine() {
  const E = require("../src/engine.js");
  const src = fs.readFileSync(path.join(__dirname, "../src/emblem-engine.js"), "utf8");
  const emblemAsm = new Function(src + "\nreturn emblemAsm;")();
  return E.load(emblemAsm);
}
module.exports = { fromDir, sampleSizes, engine };
