// Node: a real folder on disk as a folder Sync can read and write (see src/syncdir.js)
const fs = require("fs"), path = require("path");
const { Dir } = require("../src/syncdir.js");
class NodeDir extends Dir {
  constructor(rootPath, label) { super(label || path.basename(rootPath)); this.root = rootPath; this.failOn = null; }
  _p(parts) { return path.join(this.root, ...parts); }
  async _entries(parts) {
    try { return fs.readdirSync(this._p(parts), { withFileTypes: true }).map((e) => ({ name: e.name, dir: e.isDirectory() })); } catch (e) { return null; }
  }
  async _stat(parts) { try { const st = fs.statSync(this._p(parts)); return st.isFile() ? { size: st.size, mtime: st.mtimeMs } : null; } catch (e) { return null; } }
  async _read(parts, from, to) {
    const b = fs.readFileSync(this._p(parts));
    return new Uint8Array(b.buffer, b.byteOffset, b.length).slice(from || 0, to == null ? b.length : to);
  }
  async _write(parts, bytes) {
    if (this.failOn && this.failOn(parts.join("/"))) throw new Error("the write failed");
    fs.writeFileSync(this._p(parts), bytes);
  }
  async _mkdir(parts) { fs.mkdirSync(this._p(parts), { recursive: true }); }
  async _remove(parts, all) { fs.rmSync(this._p(parts), { recursive: !!all, force: true }); }
}
module.exports = { NodeDir };
