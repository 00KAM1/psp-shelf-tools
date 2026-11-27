/*
 * Shelf Tools - a folder that Sync can read and write.
 *
 * Sync works on two folders, the Memory Stick and the vault, and never cares what kind
 * they are: a folder the browser was given (FsaDir), files held in memory for the sample
 * (MemDir), or a real folder in the PC tests (tests/node_dir.js). All of them answer
 *
 *   list(path)             the entries of a folder: [{ name, dir }], or null if it is not there
 *   stat(path)             { size, mtime } of a file, or null
 *   read(path, from, to)   bytes of a file (all of it without from/to), or null
 *   write(path, bytes)     makes the folders above it as needed
 *   remove(path)           a file; removeDir(path) a folder and all in it
 *
 * Paths use "/" and are matched without regard to upper and lower case, as the Memory
 * Stick does: a PC's own folders usually do tell them apart, and the same save may be
 * "SAVEDATA" on one and "savedata" on the other.
 */
(function (root) {
  "use strict";

  // Never part of a save or of the vault: the browser's half-written files, and what file
  // managers leave behind in folders they have shown (.directory, .DS_Store, Thumbs.db ...)
  const TEMP = /\.crswap$|^\.|^(Thumbs\.db|desktop\.ini)$/i;

  class Dir {
    constructor(label) { this.label = label || ""; this._seen = new Map(); }

    // ---- what a kind of folder provides (parts: real names, already resolved) ----
    async _entries(parts) { throw new Error("not implemented"); }      // [{name, dir}] or null
    async _stat(parts) { throw new Error("not implemented"); }
    async _read(parts, from, to) { throw new Error("not implemented"); }
    async _write(parts, bytes) { throw new Error("not implemented"); }
    async _mkdir(parts) { throw new Error("not implemented"); }
    async _remove(parts, all) { throw new Error("not implemented"); }

    async _ls(parts) {
      const k = parts.join("/");
      if (!this._seen.has(k)) this._seen.set(k, await this._entries(parts));
      return this._seen.get(k);
    }
    // A folder's listing is out of date; with deep, so is everything below it.
    _forget(parts, deep) {
      const k = parts.join("/");
      this._seen.delete(k);
      if (deep) for (const key of [...this._seen.keys()]) if (!k || key.startsWith(k + "/")) this._seen.delete(key);
    }
    // The real names of a path, or null when a part of it is not there. With make,
    // missing parts keep the names given (and the folders are not made here).
    async _real(path, make) {
      const want = String(path || "").split("/").filter(Boolean);
      const parts = [];
      let missing = false;
      for (const w of want) {
        let hit = null;
        if (!missing) {
          const es = await this._ls(parts);
          if (es) hit = es.find((e) => e.name === w) || es.find((e) => e.name.toUpperCase() === w.toUpperCase()) || null;
        }
        if (!hit) { if (!make) return null; missing = true; parts.push(w); } else parts.push(hit.name);
      }
      return parts;
    }

    // Forget what was seen: the folder may have changed since it was last read
    fresh() { this._seen.clear(); }

    async list(path) {
      const parts = await this._real(path);
      if (!parts) return null;
      const es = await this._ls(parts);
      return es ? es.filter((e) => !TEMP.test(e.name)).map((e) => ({ name: e.name, dir: e.dir })) : null;
    }
    async stat(path) { const p = await this._real(path); return p && p.length ? this._stat(p) : null; }
    async exists(path) { return !!(await this._real(path)); }
    async read(path, from, to) { const p = await this._real(path); return p && p.length ? this._read(p, from, to) : null; }
    async text(path) { const b = await this.read(path); return b ? new TextDecoder("utf-8").decode(b) : null; }
    async write(path, bytes) {
      const p = await this._real(path, true);
      if (!p.length) throw new Error("no file name");
      for (let i = 1; i < p.length; i++) {
        const up = p.slice(0, i), es = await this._ls(up.slice(0, -1));
        if (!es || !es.some((e) => e.name === up[up.length - 1])) { await this._mkdir(up); this._forget(up.slice(0, -1)); }
      }
      if (typeof bytes === "string") bytes = new TextEncoder().encode(bytes);
      await this._write(p, bytes);
      this._forget(p.slice(0, -1));
    }
    async remove(path) { const p = await this._real(path); if (p && p.length) { await this._remove(p, false); this._forget(p.slice(0, -1)); } }
    async removeDir(path) { const p = await this._real(path); if (p && p.length) { await this._remove(p, true); this._forget(p, true); this._forget(p.slice(0, -1)); } }
    // Every file under a folder: [{ path (below it), size, mtime }]
    async walk(path) {
      const out = [];
      const go = async (at, rel) => {
        const es = await this.list(at);
        if (!es) return;
        for (const e of es) {
          const full = at ? at + "/" + e.name : e.name, r = rel ? rel + "/" + e.name : e.name;
          if (e.dir) await go(full, r);
          else { const st = await this.stat(full); if (st) out.push({ path: r, size: st.size, mtime: st.mtime }); }
        }
      };
      await go(path, "");
      return out;
    }
    // The same folder seen from one of its sub-folders (a PS Vita's pspemu)
    sub(path, label) { return new SubDir(this, path, label); }
  }

  class SubDir extends Dir {
    constructor(parent, path, label) { super(label || parent.label); this.parent = parent; this.pre = path.replace(/\/+$/, ""); }
    _p(path) { return path ? this.pre + "/" + path : this.pre; }
    fresh() { this.parent.fresh(); }
    list(path) { return this.parent.list(this._p(path)); }
    stat(path) { return this.parent.stat(this._p(path)); }
    exists(path) { return this.parent.exists(this._p(path)); }
    read(path, a, b) { return this.parent.read(this._p(path), a, b); }
    write(path, bytes) { return this.parent.write(this._p(path), bytes); }
    remove(path) { return this.parent.remove(this._p(path)); }
    removeDir(path) { return this.parent.removeDir(this._p(path)); }
  }

  // ---- files in memory: the sample, and the PC tests ------------------------------------
  class MemDir extends Dir {
    constructor(label) { super(label); this.files = new Map(); this.dirs = new Set(); this.writes = 0; this.failOn = null; }
    // put a file in without going through write(): { path: bytes or text }, dated mtime
    fill(files, mtime) {
      for (const [p, v] of Object.entries(files)) this.put(p, v, mtime);
      return this;
    }
    put(path, v, mtime) {
      const bytes = typeof v === "string" ? new TextEncoder().encode(v) : v;
      this.files.set(path, { bytes, mtime: mtime == null ? Date.now() : +mtime });
      const parts = path.split("/");
      for (let i = 1; i < parts.length; i++) this.dirs.add(parts.slice(0, i).join("/"));
      this._seen.clear();
    }
    async _entries(parts) {
      const pre = parts.join("/");
      if (pre && !this.dirs.has(pre)) return null;
      const out = new Map();
      const take = (p, dir) => {
        if (pre && !p.startsWith(pre + "/")) return;
        const rest = pre ? p.slice(pre.length + 1) : p;
        if (!rest) return;
        const i = rest.indexOf("/");
        if (i < 0) { if (!out.has(rest)) out.set(rest, dir); } else out.set(rest.slice(0, i), true);
      };
      for (const d of this.dirs) take(d, true);
      for (const p of this.files.keys()) take(p, false);
      return [...out].map(([name, dir]) => ({ name, dir }));
    }
    async _stat(parts) { const f = this.files.get(parts.join("/")); return f ? { size: f.bytes.length, mtime: f.mtime } : null; }
    async _read(parts, from, to) { const f = this.files.get(parts.join("/")); return f ? f.bytes.slice(from || 0, to == null ? f.bytes.length : to) : null; }
    async _write(parts, bytes) {
      const p = parts.join("/");
      if (this.failOn && this.failOn(p)) throw new Error("the write failed");
      this.writes++;
      this.files.set(p, { bytes: bytes.slice(), mtime: this.now ? this.now() : Date.now() });
    }
    async _mkdir(parts) { this.dirs.add(parts.join("/")); }
    async _remove(parts, all) {
      const p = parts.join("/");
      if (!all) { this.files.delete(p); return; }
      for (const k of [...this.files.keys()]) if (k.startsWith(p + "/")) this.files.delete(k);
      for (const d of [...this.dirs]) if (d === p || d.startsWith(p + "/")) this.dirs.delete(d);
    }
  }

  // ---- a folder the browser was given (the File System Access API) -----------------------
  class FsaDir extends Dir {
    constructor(handle, label) { super(label || handle.name); this.handle = handle; this._h = new Map(); }
    fresh() { super.fresh(); this._h.clear(); }
    async _dir(parts, make) {
      const k = parts.join("/");
      if (!parts.length) return this.handle;
      if (this._h.has(k)) return this._h.get(k);
      const up = await this._dir(parts.slice(0, -1), make);
      const h = await up.getDirectoryHandle(parts[parts.length - 1], make ? { create: true } : undefined);
      this._h.set(k, h);
      return h;
    }
    async _entries(parts) {
      let h;
      try { h = await this._dir(parts); } catch (e) { return null; }
      const out = [];
      for await (const [name, e] of h.entries()) out.push({ name, dir: e.kind === "directory" });
      return out;
    }
    async _file(parts) { return (await (await this._dir(parts.slice(0, -1))).getFileHandle(parts[parts.length - 1])).getFile(); }
    async _stat(parts) { try { const f = await this._file(parts); return { size: f.size, mtime: f.lastModified }; } catch (e) { return null; } }
    async _read(parts, from, to) {
      const f = await this._file(parts);
      const b = from == null && to == null ? f : f.slice(from || 0, to == null ? f.size : to);
      return new Uint8Array(await b.arrayBuffer());
    }
    async _write(parts, bytes) {
      const d = await this._dir(parts.slice(0, -1), true);
      const fh = await d.getFileHandle(parts[parts.length - 1], { create: true });
      const w = await fh.createWritable();      // written beside the file and swapped in when closed
      try { await w.write(bytes); await w.close(); } catch (e) { try { await w.abort(); } catch (x) { /* already gone */ } throw e; }
    }
    async _mkdir(parts) { await this._dir(parts, true); }
    async _remove(parts, all) {
      const d = await this._dir(parts.slice(0, -1));
      await d.removeEntry(parts[parts.length - 1], all ? { recursive: true } : undefined);
      const k = parts.join("/");
      for (const key of [...this._h.keys()]) if (key === k || key.startsWith(k + "/")) this._h.delete(key);
    }
  }

  const api = { Dir, SubDir, MemDir, FsaDir };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SyncDir = api;
})(typeof window !== "undefined" ? window : globalThis);
