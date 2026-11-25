/*
 * Shelf Tools - the Memory Stick as the page sees it.
 *
 * A Stick is a list of files with paths relative to the stick's root
 * ("SIDEQUEST/ULUS10558/STATE1.SQS"), each with a size, a date and a read(start, end)
 * that gives bytes. It comes from a picked folder, dropped files or folders, a zip, or
 * the built-in sample. Nothing is uploaded: files are read in the browser, and only
 * the parts that are needed (the first 404 bytes of a save state, not its 20 MB).
 */
(function (root) {
  "use strict";

  // Folders the plugins and Shelf write. The stick's root is the folder above them.
  const KNOWN = ["SIDEQUEST", "CHECKPOINT", "EMBLEM", "RUNTIME", "SHELF"];
  // What is worth keeping from a picked folder; the rest (ISOs, saves, music) is ignored.
  const WANTED = /^(SIDEQUEST|CHECKPOINT|EMBLEM|RUNTIME|SHELF)\//i;

  class Stick {
    constructor(files, label) {
      this.label = label || "";
      this.files = new Map();             // upper-case path -> file
      for (const f of files) this.files.set(f.path.toUpperCase(), f);
    }
    get(path) { return this.files.get(path.toUpperCase()) || null; }
    // Files directly inside a folder (dirs: sub-folder names).
    list(dir) {
      const pre = dir.toUpperCase().replace(/\/?$/, "/");
      const files = [], dirs = new Set();
      for (const [k, f] of this.files) {
        if (!k.startsWith(pre)) continue;
        const rest = f.path.slice(pre.length);
        const i = rest.indexOf("/");
        if (i < 0) files.push(f); else dirs.add(rest.slice(0, i));
      }
      return { files, dirs: [...dirs] };
    }
    async text(path) {
      const f = this.get(path);
      if (!f) return null;
      return new TextDecoder("utf-8").decode(await f.read(0, f.size));
    }
    async bytes(path, start, end) {
      const f = this.get(path);
      if (!f) return null;
      return f.read(start || 0, end == null ? f.size : Math.min(end, f.size));
    }
    get count() { return this.files.size; }
  }

  // Strips everything above the plugins' folders, so picking "E:\" or "PSP_STICK" or
  // the folder that holds a copy of them all work the same.
  function rootOf(paths) {
    let best = null;
    for (const p of paths) {
      const parts = p.split("/");
      for (let i = 0; i < parts.length - 1; i++) {
        if (KNOWN.includes(parts[i].toUpperCase())) {
          const pre = parts.slice(0, i).join("/");
          if (best === null || pre.length < best.length) best = pre;
          break;
        }
      }
    }
    return best;
  }

  function fromEntries(list, label) {
    // list: [{ path, size, mtime, read }]
    const pre = rootOf(list.map((f) => f.path));
    if (pre === null) return new Stick([], label);
    const cut = pre ? pre.length + 1 : 0;
    const kept = [];
    for (const f of list) {
      if (pre && !f.path.startsWith(pre + "/")) continue;
      const p = f.path.slice(cut);
      if (WANTED.test(p)) kept.push(Object.assign({}, f, { path: p }));
    }
    return new Stick(kept, label);
  }

  const fileRead = (file) => (s, e) => file.slice(s, e).arrayBuffer().then((b) => new Uint8Array(b));

  // <input type=file webkitdirectory> or a multi-file pick: File objects with webkitRelativePath.
  function fromFileList(fileList, label) {
    const list = [];
    for (const file of fileList) {
      const path = (file.webkitRelativePath || file.name).replace(/\\/g, "/");
      list.push({ path, size: file.size, mtime: file.lastModified ? new Date(file.lastModified) : null, read: fileRead(file) });
    }
    return fromEntries(list, label);
  }

  // Dropped items. The browser only hands out a drop's entries while the drop event
  // is being handled, so dropEntries() must be called there, before anything is awaited;
  // fromDrop() then walks the folders at its own pace.
  function dropEntries(items) {
    const out = [];
    for (const it of items) {
      const e = it.webkitGetAsEntry ? it.webkitGetAsEntry() : null;
      if (e) out.push(e);
    }
    return out;
  }
  const entryFile = (entry) => new Promise((ok, no) => entry.file(ok, no));
  async function fromDrop(entries, label) {
    const list = [];
    const walk = async (entry, prefix) => {
      if (entry.isFile) {
        const file = await entryFile(entry);
        list.push({ path: prefix + file.name, size: file.size, mtime: file.lastModified ? new Date(file.lastModified) : null, read: fileRead(file) });
      } else if (entry.isDirectory) {
        // Skip what is never needed and can be huge (at the stick's top: the drop's
        // top, or one folder down when the drive itself was dropped)
        if (/^(ISO|PSP|MUSIC|VIDEO|PICTURE|SEPLUGINS)$/i.test(entry.name) && prefix.split("/").length <= 2) return;
        const reader = entry.createReader();
        for (;;) {      // readEntries gives a folder in batches; an empty one ends it
          const batch = await new Promise((ok, no) => reader.readEntries(ok, no));
          if (!batch.length) break;
          for (const e of batch) await walk(e, prefix + entry.name + "/");
        }
      }
    };
    const zip = entries.length === 1 && entries[0].isFile && /\.zip$/i.test(entries[0].name);
    if (zip) return fromZip(await entryFile(entries[0]));
    for (const e of entries) await walk(e, "");
    // A drop of the folders themselves (SIDEQUEST, CHECKPOINT...) has them at the top.
    return fromEntries(list.map((f) => Object.assign(f, { path: "stick/" + f.path })), label);
  }

  // ---- zip ------------------------------------------------------------------------
  // Reads the central directory and inflates only what is asked for, through the
  // browser's own DecompressionStream. Stored and deflated entries; zip64 sizes.
  async function fromZip(file) {
    const read = fileRead(file);
    const size = file.size;
    const tailLen = Math.min(size, 65557);
    const tail = await read(size - tailLen, size);
    const dv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("This file is not a zip, or it is damaged.");
    let count = dv.getUint16(eocd + 10, true), cdSize = dv.getUint32(eocd + 12, true), cdOff = dv.getUint32(eocd + 16, true);
    if (cdOff === 0xffffffff || count === 0xffff) {
      const loc = eocd - 20;
      if (loc >= 0 && dv.getUint32(loc, true) === 0x07064b50) {
        const z64off = Number(dv.getBigUint64(loc + 8, true));
        const z = await read(z64off, z64off + 56);
        const zd = new DataView(z.buffer, z.byteOffset, z.byteLength);
        count = Number(zd.getBigUint64(32, true)); cdSize = Number(zd.getBigUint64(40, true)); cdOff = Number(zd.getBigUint64(48, true));
      }
    }
    const cd = await read(cdOff, cdOff + cdSize);
    const cv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
    const dec = new TextDecoder("utf-8");
    const list = [];
    let p = 0;
    for (let n = 0; n < count && p + 46 <= cd.length; n++) {
      if (cv.getUint32(p, true) !== 0x02014b50) break;
      const method = cv.getUint16(p + 10, true);
      const time = cv.getUint16(p + 12, true), date = cv.getUint16(p + 14, true);
      let csize = cv.getUint32(p + 20, true), usize = cv.getUint32(p + 24, true);
      const nlen = cv.getUint16(p + 28, true), xlen = cv.getUint16(p + 30, true), clen = cv.getUint16(p + 32, true);
      let off = cv.getUint32(p + 42, true);
      const name = dec.decode(cd.subarray(p + 46, p + 46 + nlen)).replace(/\\/g, "/");
      let x = p + 46 + nlen;
      const xend = x + xlen;
      while (x + 4 <= xend) {
        const id = cv.getUint16(x, true), len = cv.getUint16(x + 2, true);
        if (id === 1) {
          let q = x + 4;
          if (usize === 0xffffffff) { usize = Number(cv.getBigUint64(q, true)); q += 8; }
          if (csize === 0xffffffff) { csize = Number(cv.getBigUint64(q, true)); q += 8; }
          if (off === 0xffffffff) { off = Number(cv.getBigUint64(q, true)); }
        }
        x += 4 + len;
      }
      p = xend + clen;
      if (name.endsWith("/")) continue;
      const mtime = new Date(1980 + (date >> 9), ((date >> 5) & 15) - 1, date & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2);
      const entry = { method, csize, usize, off, dataAt: null };
      list.push({
        path: name, size: usize, mtime,
        read: async (s, e) => {
          if (entry.dataAt === null) {
            const h = await read(entry.off, entry.off + 30);
            const hv = new DataView(h.buffer, h.byteOffset, h.byteLength);
            entry.dataAt = entry.off + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
          }
          if (entry.method === 0) return read(entry.dataAt + s, entry.dataAt + e);
          if (entry.method !== 8) throw new Error("Unsupported compression in " + name);
          return inflatePart(file.slice(entry.dataAt, entry.dataAt + entry.csize), e).then((b) => b.subarray(s, e));
        },
      });
    }
    return fromEntries(list.map((f) => Object.assign(f, { path: "zip/" + f.path })), file.name);
  }

  // Inflates a deflate stream up to `want` bytes, then stops reading.
  async function inflatePart(blob, want) {
    const ds = blob.stream().pipeThrough(new DecompressionStream("deflate-raw"));
    const reader = ds.getReader();
    const parts = [];
    let got = 0;
    while (got < want) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value); got += value.length;
    }
    reader.cancel().catch(() => {});
    const out = new Uint8Array(got);
    let o = 0;
    for (const v of parts) { out.set(v, o); o += v.length; }
    return out;
  }

  // The sample stick, packed into the page by tools/build.py: { path: [size, mtime, base64] }.
  function fromPacked(packed, label) {
    const list = [];
    for (const [path, [size, mtime, b64]] of Object.entries(packed)) {
      let bytes = null;
      list.push({
        path: "sample/" + path, size, mtime: mtime ? new Date(mtime) : null,
        read: async (s, e) => {
          if (!bytes) { const bin = atob(b64); bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); }
          return bytes.slice(s, Math.min(e, bytes.length));
        },
      });
    }
    return fromEntries(list, label);
  }

  const api = { Stick, fromEntries, fromFileList, dropEntries, fromDrop, fromZip, fromPacked, rootOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.StickIO = api;
})(typeof window !== "undefined" ? window : globalThis);
