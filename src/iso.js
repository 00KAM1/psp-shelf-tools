/*
 * Shelf Tools - reading a game's own files out of its image, without reading the image.
 *
 * A game on the Memory Stick is an ISO, a CSO (v1 or v2) or a ZSO, or for PS1 games and
 * homebrew an EBOOT.PBP. Its name, disc ID and icon are small files inside. This reads
 * only the pieces that hold them: an ISO's volume header and two or three folders, a
 * compressed image's block index and the few blocks those files are in. It is Shelf's own
 * reader (iso.c in psp-shelf-launcher), in JavaScript.
 *
 * A file here is { size, read(start, end) -> bytes }, as the Memory Stick reader gives.
 */
(function (root) {
  "use strict";

  const SECTOR = 2048;
  const u16 = (b, at) => b[at] | (b[at + 1] << 8);
  const u32 = (b, at) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
  const cstr = (b, at, len) => { let e = at; while (e < at + len && e < b.length && b[e]) e++; return new TextDecoder("utf-8").decode(b.subarray(at, e)); };
  const tag = (b, at, s) => { for (let i = 0; i < s.length; i++) if (b[at + i] !== s.charCodeAt(i)) return false; return true; };

  // LZ4 block format, as ZSO and CSO v2 use it. Bytes written into dst, or -1.
  function lz4(src, dst) {
    let ip = 0, op = 0;
    const iend = src.length, oend = dst.length;
    while (ip < iend) {
      const token = src[ip++];
      let lit = token >> 4;
      if (lit === 15) { let b; do { if (ip >= iend) return -1; b = src[ip++]; lit += b; } while (b === 255); }
      if (iend - ip < lit || oend - op < lit) return -1;
      dst.set(src.subarray(ip, ip + lit), op); op += lit; ip += lit;
      if (ip >= iend) break;                       // the last sequence has no match
      if (iend - ip < 2) return -1;
      const off = src[ip] | (src[ip + 1] << 8); ip += 2;
      if (!off || off > op) return -1;
      let mlen = token & 15;
      if (mlen === 15) { let b; do { if (ip >= iend) return -1; b = src[ip++]; mlen += b; } while (b === 255); }
      mlen += 4;
      if (oend - op < mlen) return -1;
      for (let i = 0, m = op - off; i < mlen; i++) dst[op++] = dst[m + i];
    }
    return op;
  }
  // Raw deflate, as CSO uses it. A block may be followed by padding, which the browser's
  // decompressor reports as an error after it has given the block: what came out is kept.
  async function inflate(src, dst) {
    const ds = new DecompressionStream("deflate-raw"), w = ds.writable.getWriter(), r = ds.readable.getReader();
    w.write(src).catch(() => {}); w.close().catch(() => {});
    let op = 0;
    try {
      for (;;) {
        const { done, value } = await r.read();
        if (done) break;
        const take = Math.min(value.length, dst.length - op);
        dst.set(value.subarray(0, take), op); op += take;
        if (op >= dst.length) { r.cancel().catch(() => {}); break; }
      }
    } catch (e) { if (!op) return -1; }
    return op;
  }

  // PARAM.SFO: the text and number fields by name
  function sfo(b) {
    const out = {};
    if (!b || b.length < 20 || u32(b, 0) !== 0x46535000) return out;
    const keys = u32(b, 8), data = u32(b, 12), n = u32(b, 16);
    for (let i = 0; i < n && 20 + (i + 1) * 16 <= b.length; i++) {
      const at = 20 + i * 16, k = cstr(b, keys + u16(b, at), 64), fmt = u16(b, at + 2), len = u32(b, at + 4), off = data + u32(b, at + 12);
      if (off + len > b.length) continue;
      out[k] = fmt === 0x0404 ? u32(b, off) : cstr(b, off, len);
    }
    return out;
  }

  class Image {
    constructor(file) { this.file = file; this.fmt = ""; this.total = 0; this.block = SECTOR; this.cur = -1; this.ix = null; this.ixFirst = 0; }
    async open() {
      const f = this.file, h = await f.read(0, Math.min(24, f.size));
      if (h.length >= 24 && (tag(h, 0, "CISO") || tag(h, 0, "ZISO"))) {
        this.fmt = h[0] === 0x5a ? "ZSO" : "CSO";
        this.total = u32(h, 8) + u32(h, 12) * 4294967296;
        this.block = u32(h, 16); this.ver = h[20]; this.align = h[21];
        if (this.block < SECTOR || this.block > 0x20000 || (this.block & (this.block - 1)) || this.align > 16) throw new Error("not a CSO or ZSO this page can read");
        this.nblocks = Math.ceil(this.total / this.block);
        this.buf = new Uint8Array(this.block);
      } else { this.fmt = "ISO"; this.total = f.size; }
      return this;
    }
    async _block(n) {
      if (n === this.cur) return;
      if (n >= this.nblocks) throw new Error("past the end of the image");
      if (!this.ix || n < this.ixFirst || n >= this.ixFirst + this.ix.length / 4 - 1) {       // one read covers the next 256 blocks
        const want = Math.min(256, this.nblocks - n);
        const b = await this.file.read(24 + n * 4, 24 + (n + want + 1) * 4);
        if (b.length < (want + 1) * 4) throw new Error("the image is cut short (its index ends early)");
        this.ix = b; this.ixFirst = n;
      }
      const a = u32(this.ix, (n - this.ixFirst) * 4), b = u32(this.ix, (n - this.ixFirst + 1) * 4);
      const start = (a & 0x7fffffff) * (1 << this.align);
      let end = (b & 0x7fffffff) * (1 << this.align);
      if (end <= start) throw new Error("the image's index is damaged");
      if (end - start > this.block * 2 + 64) end = start + this.block * 2 + 64;
      const c = await this.file.read(start, end);
      if (!c.length) throw new Error("the image is cut short");
      const plain = () => { this.buf.fill(0); this.buf.set(c.subarray(0, Math.min(c.length, this.block))); return this.block; };
      let out;
      this.buf.fill(0);
      if (this.fmt === "ZSO") out = a & 0x80000000 ? plain() : lz4(c, this.buf);
      else if (this.ver >= 2) out = c.length >= this.block ? plain() : a & 0x80000000 ? lz4(c, this.buf) : await inflate(c, this.buf);
      else out = a & 0x80000000 ? plain() : await inflate(c, this.buf);
      if (out < 0) throw new Error("a block of the image could not be unpacked");
      this.cur = n;
    }
    async read(off, len) {
      if (this.fmt === "ISO") { const b = await this.file.read(off, off + len); if (b.length < len) throw new Error("the image is cut short"); return b; }
      const out = new Uint8Array(len);
      for (let done = 0; done < len; ) {
        const n = Math.floor((off + done) / this.block), at = (off + done) % this.block, take = Math.min(this.block - at, len - done);
        await this._block(n);
        out.set(this.buf.subarray(at, at + take), done);
        done += take;
      }
      return out;
    }
    // Where "PSP_GAME/ICON0.PNG" is: { off, size }, or null
    async find(path) {
      const pvd = await this.read(16 * SECTOR, SECTOR);
      if (!tag(pvd, 1, "CD001")) return null;
      let dir = u32(pvd, 158), dsize = u32(pvd, 166);
      for (const part of path.split("/")) {
        let hit = null;
        for (let s = 0; s < Math.ceil(dsize / SECTOR) && s < 64 && !hit; s++) {
          const sec = await this.read((dir + s) * SECTOR, SECTOR);
          for (let o = 0; o < SECTOR; ) {
            const rl = sec[o];
            if (!rl || o + rl > SECTOR || rl < 34) break;
            let name = cstr(sec, o + 33, sec[o + 32]);
            if (name.includes(";")) name = name.slice(0, name.indexOf(";"));
            if (name.toUpperCase() === part.toUpperCase()) { hit = { off: u32(sec, o + 2), size: u32(sec, o + 10) }; break; }
            o += rl;
          }
        }
        if (!hit) return null;
        dir = hit.off; dsize = hit.size;
      }
      return { off: dir * SECTOR, size: dsize };
    }
    async load(path, max) {
      const at = await this.find(path);
      if (!at || !at.size || at.size > max) return null;
      return this.read(at.off, at.size);
    }
  }

  // Is the image whole? { ok, why } without unpacking anything: a plain ISO says how large
  // its volume is, and a compressed one's index says where its last block ends.
  async function whole(file) {
    if (!file.size) return { ok: false, why: "the file is empty" };
    const h = await file.read(0, Math.min(24, file.size));
    if (h.length >= 24 && (tag(h, 0, "CISO") || tag(h, 0, "ZISO"))) {
      const total = u32(h, 8) + u32(h, 12) * 4294967296, block = u32(h, 16), align = h[21];
      if (block < SECTOR || (block & (block - 1)) || align > 16) return { ok: false, why: "its header is damaged" };
      const n = Math.ceil(total / block), at = 24 + n * 4;
      const e = await file.read(at, at + 4);
      if (e.length < 4) return { ok: false, why: "the file ends inside its own index" };
      const end = (u32(e, 0) & 0x7fffffff) * (1 << align);
      return end > file.size ? { ok: false, why: `it should be ${end} bytes and is ${file.size}`, need: end } : { ok: true };
    }
    if (file.size < 17 * SECTOR) return { ok: false, why: "it is too small to be a game" };
    const pvd = await file.read(16 * SECTOR, 17 * SECTOR);
    if (!tag(pvd, 1, "CD001")) return { ok: true, odd: "not a disc image" };
    const need = u32(pvd, 80) * (u16(pvd, 128) || SECTOR);
    return need > file.size ? { ok: false, why: `it should be ${need} bytes and is ${file.size}`, need } : { ok: true };
  }

  // What a game image says of itself: { title, id, icon() } or null when it is not a game
  async function game(file) {
    const img = await new Image(file).open();
    const s = await img.load("PSP_GAME/PARAM.SFO", 65536);
    if (!s) return null;
    const f = sfo(s);
    return { fmt: img.fmt, title: (f.TITLE || "").trim(), id: (f.DISC_ID || "").replace(/[- ]/g, ""), icon: () => img.load("PSP_GAME/ICON0.PNG", 1 << 20) };
  }

  // An EBOOT.PBP: { kind, title, id, icon() }. kind is "PS1", "PSN", "Homebrew", or "" for
  // what is not a game (an update, DLC), as Shelf sorts them.
  async function eboot(file) {
    const h = await file.read(0, Math.min(40, file.size));
    if (h.length < 40 || u32(h, 0) !== 0x50425000) return null;
    const off = []; for (let i = 0; i < 8; i++) off.push(u32(h, 8 + i * 4));
    const s = off[1] > off[0] && off[1] - off[0] < 65536 ? sfo(await file.read(off[0], off[1])) : {};
    const cat = s.CATEGORY || "";
    const kind = !cat || cat === "MG" ? "Homebrew" : cat === "EG" ? "PSN" : cat === "ME" ? "PS1" : "";
    let id = (s.DISC_ID || "").replace(/[- ]/g, "");
    if (kind === "Homebrew" && id === "UCJS10041") id = "";          // the SDK's default id says nothing
    return { kind, title: (s.TITLE || "").trim(), id, icon: async () => (off[2] > off[1] && off[2] - off[1] < (1 << 20) ? file.read(off[1], off[2]) : null) };
  }

  const api = { Image, whole, game, eboot, sfo, lz4 };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.GameImage = api;
})(typeof window !== "undefined" ? window : globalThis);
