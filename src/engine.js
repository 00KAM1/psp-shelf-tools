/*
 * Shelf Tools - Emblem's engine (emblem.wasm) for the page and for the Node tests.
 * emblem-engine.js is em.c, the plugin's own rule engine, unchanged, compiled to
 * JavaScript; this wraps it.
 */
(function (root) {
  "use strict";
  const RAM_LO = 0x08800000, RAM_HI = 0x0A000000;

  // What the game's memory holds while a check runs: a fill byte, or a dump.
  // A dump is a byte array starting at `base` (0x08800000 for a 24 MB user-RAM dump,
  // 0x08000000 for a 32 MB one that starts at the kernel's RAM).
  function makeMemory() {
    const m = { fill: 0, dump: null, base: RAM_LO };
    m.r8 = (a) => {
      if (m.dump) { const i = a - m.base; return i >= 0 && i < m.dump.length ? m.dump[i] : 0; }
      return m.fill;
    };
    m.r16 = (a) => m.r8(a) | (m.r8(a + 1) << 8);
    m.r32 = (a) => (m.r8(a) | (m.r8(a + 1) << 8) | (m.r8(a + 2) << 16) | (m.r8(a + 3) << 24)) >>> 0;
    return m;
  }

  // factory: emblemAsm from emblem-engine.js (em.c built with clang, then wasm2js:
  // plain JavaScript, so the page needs no WebAssembly permission).
  function load(factory) {
    const mem = makeMemory();
    const x = factory({ js_r8: (a) => mem.r8(a >>> 0), js_r16: (a) => mem.r16(a >>> 0), js_r32: (a) => mem.r32(a >>> 0) });
    const enc = new TextEncoder(), dec = new TextDecoder();
    const heap = () => new Uint8Array(x.memory.buffer);
    const cstr = (p) => { const h = heap(); let e = p; while (h[e]) e++; return dec.decode(h.subarray(p, e)); };

    // Reads a game file the way the plugin does. Returns errors, achievements and pool use.
    function check(text) {
      const raw = enc.encode(text);
      const bytes = raw.length;
      const n = Math.min(bytes, 64 * 1024);
      heap().set(raw.subarray(0, n), x.glue_text());
      const lines = x.glue_load(n);
      const res = { lines, bytes, errors: [], ach: [], game: "", title: "", limits: {} };
      for (const l of cstr(x.glue_out()).split("\n")) {
        const f = l.split("\t");
        if (f[0] === "E") res.errors.push({ line: +f[1], msg: f[2], text: f[3] });
        else if (f[0] === "G") { res.game = f[1]; res.title = f[2]; }
        else if (f[0] === "A") res.ach.push({ n: +f[1], points: +f[2], included: +f[3] === 1, timed: +f[4] === 1, gated: +f[5] === 1, title: f.slice(6).join("\t") });
        else if (f[0] === "L") {
          res.limits = { nodes: +f[1], addrs: +f[2], snaps: +f[3], runs: +f[4], defs: +f[5], show: +f[6] };
          res.hasReady = +f[7] === 1;
          res.total = +f[9];
        }
      }
      return res;
    }

    // Runs the loaded file for `seconds` of game time over a fill byte (0x00, 0xFF) or a dump.
    // What the emblem docs ask before a file goes on the PSP: nothing unlocks from
    // memory that is all zeros or all 0xFF. Returns { readyHeld, fired: [n...] }.
    function run(text, memory, seconds) {
      check(text);
      mem.fill = memory.fill || 0; mem.dump = memory.dump || null; mem.base = memory.base || RAM_LO;
      const fired = [];
      let readyHeld = false;
      const ticks = Math.round((seconds || 3) * 60);
      for (let t = 1; t <= ticks; t++) {
        const k = x.glue_step(t * 16);
        if (x.glue_stable() >= 60) readyHeld = true;
        if (k > 0) {
          const met = new Int32Array(x.memory.buffer, x.glue_met(), k);
          const earned = heap();
          for (const id of met) { fired.push(id); earned[x.glue_earned() + id] = 1; }
        }
      }
      const show = [];
      for (let i = 0; i < x.glue_nshow(); i++) show.push({ name: cstr(x.glue_show_name(i)), value: x.glue_show_value(i) });
      mem.dump = null;
      return { readyHeld, fired, show };
    }

    return { check, run };
  }

  const api = { load, RAM_LO, RAM_HI };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.EmblemEngine = api;
})(typeof window !== "undefined" ? window : globalThis);
