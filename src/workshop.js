/*
 * Shelf Tools - the Emblem Workshop. The text of the game file is the one truth;
 * the Achievements and Names tabs are views of its lines, and every change runs the
 * file through Emblem's own engine (em.c, compiled to JavaScript), so the errors and
 * the counts are the plugin's, line for line.
 */
{
  "use strict";
  const { $, esc } = App;
  const LIMITS = [["bytes", "File size", 32768], ["nodes", "Nodes", 1280], ["addrs", "List addresses", 1024], ["runs", "Runs", 64], ["defs", "Names", 192], ["snaps", "moved snapshots", 512]];
  const DRAFT = "shelftools.emblem.draft";
  let text = "", sub = "ach", result = null, mem = null, timer = 0, dump = null;

  const TEMPLATE = `# Emblem game file. One thing per line; '#' starts a comment.
# Addresses: RetroAchievements' code notes, RA address + 0x08000000.

game ULUS00000 New game

level = u32 08800000          # a name for a value: u8 / u16 / u32 / s32 / float ADDR [bit N]
ready = level 1..99           # when the game is really being played

1 | First steps | 5 | level >= 2
`;

  // ---- lines ------------------------------------------------------------------------------
  const RX = {
    game: /^\s*game\s+(\S+)\s*(.*?)\s*$/,
    ach: /^\s*(\d+)\s*\|([^|]*)\|([^|]*)\|(.*)$/,
    when: /^\s*when\s+(.*?)\s*$/,
    show: /^\s*show\b\s*(.*?)\s*$/,
    def: /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/,
  };
  // splits "rule   # comment" (a # inside the rule is always a comment in Emblem's files)
  function split(s) { const i = s.indexOf("#"); return i < 0 ? [s.trim(), ""] : [s.slice(0, i).trim(), s.slice(i + 1).trim()]; }
  function classify(l) {
    const t = l.trim();
    if (!t || t[0] === "#") return { kind: "note" };
    let m;
    if ((m = RX.game.exec(l))) { const [title, c] = split(m[2]); return { kind: "game", id: m[1], title, c }; }
    if ((m = RX.ach.exec(l))) { const [rule, c] = split(m[4]); return { kind: "ach", n: m[1].trim(), title: m[2].trim(), points: m[3].trim(), rule, c }; }
    if ((m = RX.when.exec(l))) { const [rule, c] = split(m[1]); return { kind: "when", rule, c }; }
    if ((m = RX.show.exec(l))) { const [rule, c] = split(m[1]); return { kind: "show", rule, c }; }
    if ((m = RX.def.exec(l))) { const [rule, c] = split(m[2]); return { kind: "def", name: m[1], rule, c }; }
    return { kind: "other" };
  }
  const tail = (c) => (c ? `   # ${c}` : "");
  function rebuild(x) {
    if (x.kind === "ach") return `${x.n} | ${x.title} | ${x.points} | ${x.rule}${tail(x.c)}`;
    if (x.kind === "def") return `${x.name} = ${x.rule}${tail(x.c)}`;
    if (x.kind === "when") return `when ${x.rule}${tail(x.c)}`;
    if (x.kind === "show") return `show ${x.rule}${tail(x.c)}`;
    if (x.kind === "game") return `game ${x.id} ${x.title}${tail(x.c)}`.replace(/\s+$/, "");
    return "";
  }
  const lines = () => text.split("\n");
  function setLine(i, s) { const ls = lines(); ls[i] = s + (ls[i].endsWith("\r") ? "\r" : ""); text = ls.join("\n"); changed(false); }
  function insertAt(i, s) { const ls = lines(); const cr = text.includes("\r\n") ? "\r" : ""; ls.splice(i, 0, s + cr); text = ls.join("\n"); changed(true); }
  function removeAt(i) { const ls = lines(); ls.splice(i, 1); text = ls.join("\n"); changed(true); }

  // ---- loading a file ----------------------------------------------------------------------
  function open(t, label) {
    text = (t || "").replace(/^﻿/, "");
    $("#mkText").value = text;
    changed(true, true);
    if (label) App.toast(label);
  }
  App.openEmblem = open;

  function changed(redraw, fromOpen) {
    if (redraw) { drawRows(); }
    if ($("#mkText").value !== text) $("#mkText").value = text;
    gutter();
    syncFields();
    try { localStorage.setItem(DRAFT, text); } catch (e) { /* private mode */ }
    clearTimeout(timer);
    timer = setTimeout(check, fromOpen ? 0 : 200);
  }

  function syncFields() {
    const g = lines().map(classify).find((x) => x.kind === "game");
    const id = $("#mkId"), ti = $("#mkTitle");
    if (document.activeElement !== id) id.value = g ? g.id : "";
    if (document.activeElement !== ti) ti.value = g ? g.title : "";
  }
  function editGame(field, v) {
    const ls = lines();
    let i = ls.findIndex((l) => classify(l).kind === "game");
    if (i < 0) {
      let at = 0; while (at < ls.length && classify(ls[at]).kind === "note" && ls[at].trim()) at++;
      insertAt(at, `game ${field === "id" ? v : "ULUS00000"} ${field === "title" ? v : ""}`.trim());
      return;
    }
    const x = classify(ls[i]);
    x[field] = field === "id" ? v.replace(/[\s-]/g, "").toUpperCase() : v;
    setLine(i, rebuild(x));
  }
  $("#mkId").addEventListener("input", (e) => editGame("id", e.target.value));
  $("#mkTitle").addEventListener("input", (e) => editGame("title", e.target.value));

  // ---- the Achievements and Names tabs -------------------------------------------------------
  function drawRows() {
    const ls = lines();
    const xs = ls.map(classify);
    // achievements, by 'when' section
    let h = "", open = false, sections = 0;
    const startSect = (label, i) => {
      h += `<div class="sect">${label}${i != null ? `<input class="inp mono" data-line="${i}" data-f="rule" value="${esc(xs[i].rule)}" style="flex:1 1 180px;min-height:36px;font-size:14px" aria-label="When">` : ""}</div>`;
    };
    const firstAch = xs.findIndex((x) => x.kind === "ach");
    xs.forEach((x, i) => {
      if (x.kind === "when") { startSect("When", i); open = true; sections++; }
      if (x.kind !== "ach") return;
      if (!open) { startSect("Always looked at (once ready holds)"); open = true; }
      h += `<div class="arow ${x.rule === "none" ? "none" : ""}" data-row="${i}">
        <input class="inp mono" data-line="${i}" data-f="n" value="${esc(x.n)}" inputmode="numeric" aria-label="Number">
        <input class="inp" data-line="${i}" data-f="title" value="${esc(x.title)}" maxlength="47" aria-label="Title">
        <input class="inp mono" data-line="${i}" data-f="points" value="${esc(x.points)}" inputmode="numeric" aria-label="Points">
        <button class="x" data-del="${i}" aria-label="Delete">✕</button>
        <input class="inp mono rule" data-line="${i}" data-f="rule" value="${esc(x.rule)}" spellcheck="false" autocapitalize="off" aria-label="Rule" placeholder="rule, or none">
        <div class="msg" data-msg="${i}" hidden></div>
      </div>`;
    });
    if (firstAch < 0) h += `<p class="empty">No achievements yet.</p>`;
    h += `<div class="toolbar" style="margin-top:10px"><button class="btn small" id="addAch">Add an achievement</button><button class="btn small" id="addWhen">Add a 'when' section</button></div>
      <p class="note">A rule of <code>none</code> lists an achievement the file cannot unlock; Emblem leaves it out of the totals. Titles: up to 47 characters (the pop-up shows two lines of 29).</p>`;
    $("#sub-ach").innerHTML = h;

    // names, ready, show
    let n = `<p class="muted small">Names for values, lists and rules, in file order. A name must be defined above the lines that use it.</p>`;
    xs.forEach((x, i) => {
      if (x.kind === "def") n += `<div class="drow" data-row="${i}"><input class="inp mono" data-line="${i}" data-f="name" value="${esc(x.name)}" aria-label="Name" ${x.name === "ready" ? 'style="color:var(--amber)"' : ""}><input class="inp mono" data-line="${i}" data-f="rule" value="${esc(x.rule)}" spellcheck="false" autocapitalize="off" aria-label="Definition"><button class="x" data-del="${i}" aria-label="Delete">✕</button><div class="msg" data-msg="${i}" hidden></div></div>`;
      if (x.kind === "show") n += `<div class="drow" data-row="${i}"><input class="inp mono" value="show" disabled aria-label="show"><input class="inp mono" data-line="${i}" data-f="rule" value="${esc(x.rule)}" aria-label="Values the viewer shows"><button class="x" data-del="${i}" aria-label="Delete">✕</button><div class="msg" data-msg="${i}" hidden></div></div>`;
    });
    const hasReady = xs.some((x) => x.kind === "def" && x.name === "ready");
    const hasShow = xs.some((x) => x.kind === "show");
    n += `<div class="toolbar" style="margin-top:10px"><button class="btn small" id="addDef">Add a name</button>${hasReady ? "" : `<button class="btn small main" id="addReady">Add ready</button>`}${hasShow ? "" : `<button class="btn small" id="addShow">Add show</button>`}</div>
      <p class="note"><b>ready</b> is the only thing between leftover memory and a false unlock: give it the mode value and three or four values with narrow, sane ranges. <b>show</b> lists up to 9 values for the viewer's values page.</p>`;
    $("#sub-names").innerHTML = n;
    bindRows();
    marks();
  }

  function bindRows() {
    for (const el of document.querySelectorAll("#sub-ach [data-line], #sub-names [data-line]")) {
      el.addEventListener("input", () => {
        const i = +el.dataset.line;
        const x = classify(lines()[i]);
        x[el.dataset.f] = el.value;
        setLine(i, rebuild(x));
        if (el.dataset.f === "rule") el.closest(".arow")?.classList.toggle("none", el.value.trim() === "none");
      });
    }
    for (const b of document.querySelectorAll("[data-del]")) b.addEventListener("click", () => removeAt(+b.dataset.del));
    const ls = lines(), xs = ls.map(classify);
    const lastOf = (k) => { for (let i = xs.length - 1; i >= 0; i--) if (k.includes(xs[i].kind)) return i; return -1; };
    const on = (id, fn) => { const b = $(id); if (b) b.addEventListener("click", fn); };
    on("#addAch", () => {
      const used = new Set(xs.filter((x) => x.kind === "ach").map((x) => +x.n));
      let n = 1; while (used.has(n) && n < 255) n++;
      insertAt(lastOf(["ach", "when"]) + 1 || ls.length, `${n} | New achievement | 5 | none`);
      setTimeout(() => { const r = document.querySelectorAll("#sub-ach .arow"); const last = r[r.length - 1]; if (last) last.querySelector('[data-f="title"]').select(); }, 0);
    });
    on("#addWhen", () => insertAt(ls.length, "when ready"));
    const defAt = () => { const d = lastOf(["def", "show"]); if (d >= 0) return d + 1; const g = lastOf(["game"]); return g + 1; };
    on("#addDef", () => insertAt(defAt(), "name = u32 08800000"));
    on("#addReady", () => insertAt(defAt(), "ready = "));
    on("#addShow", () => insertAt(defAt(), "show "));
  }

  // error marks on the rows and the gutter
  function marks() {
    const errs = new Map();
    if (result) for (const e of result.errors) errs.set(e.line - 1, e.msg);
    for (const el of document.querySelectorAll("[data-msg]")) {
      const m = errs.get(+el.dataset.msg);
      el.hidden = !m; el.textContent = m || "";
      el.parentElement.classList.toggle("bad", !!m);
    }
    gutter();
  }
  function gutter() {
    const n = lines().length;
    const bad = new Set(result ? result.errors.map((e) => e.line) : []);
    let s = "";
    for (let i = 1; i <= n; i++) s += bad.has(i) ? `<span class="e">${i}</span>\n` : i + "\n";
    $("#gutter").innerHTML = s;
  }
  const ta = $("#mkText");
  ta.addEventListener("input", () => { text = ta.value; changed(false); });
  ta.addEventListener("scroll", () => { $("#gutter").scrollTop = ta.scrollTop; });
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Tab" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const a = ta.selectionStart; ta.setRangeText("    ", a, ta.selectionEnd, "end"); text = ta.value; changed(false);
    }
  });

  function showSub(name) {
    sub = name;
    for (const t of document.querySelectorAll(".subtabs .tab")) t.setAttribute("aria-selected", String(t.dataset.sub === name));
    $("#sub-ach").hidden = name !== "ach"; $("#sub-names").hidden = name !== "names"; $("#sub-text").hidden = name !== "text";
    if (name !== "text") drawRows(); else { ta.value = text; gutter(); }
  }
  for (const t of document.querySelectorAll(".subtabs .tab")) t.addEventListener("click", () => showSub(t.dataset.sub));
  function goLine(no) {
    showSub("text");
    const ls = lines();
    let a = 0; for (let i = 0; i < no - 1 && i < ls.length; i++) a += ls[i].length + 1;
    ta.focus(); ta.setSelectionRange(a, a + (ls[no - 1] || "").length);
    ta.scrollTop = Math.max(0, (no - 6) * 21);
  }

  // ---- checks ----------------------------------------------------------------------------
  function check() {
    const E = App.engine;
    result = E.check(text);
    mem = { zero: E.run(text, { fill: 0 }, 3), ff: E.run(text, { fill: 0xff }, 3) };
    if (dump) dump.res = E.run(text, { dump: dump.bytes, base: dump.base }, 3);
    result = E.check(text);              // run() used the engine; read the file once more for the panel
    drawChecks();
    marks();
  }

  function drawChecks() {
    const r = result;
    const counted = r.ach.filter((a) => a.included), listed = lines().map(classify).filter((x) => x.kind === "ach" && x.rule === "none").length;
    const pts = counted.reduce((s, a) => s + a.points, 0);
    const ids = new Set(r.ach.map((a) => a.n));
    const lim = { ...r.limits, bytes: r.bytes };
    const memBad = [mem.zero, mem.ff].some((m) => m.fired.length);
    const readyWeak = r.hasReady && (mem.zero.readyHeld || mem.ff.readyHeld);
    let verdict, cls;
    if (r.errors.length) { verdict = `${r.errors.length} line${r.errors.length === 1 ? "" : "s"} Emblem would skip`; cls = "bad"; }
    else if (r.bytes > 32768) { verdict = "Too big for Emblem (32 KB)"; cls = "bad"; }
    else if (!r.game) { verdict = "No game line yet"; cls = "bad"; }
    else if (!r.hasReady || memBad) { verdict = !r.hasReady ? "No ready rule" : "Unlocks from empty memory"; cls = "warn"; }
    else { verdict = "Ready for the PSP"; cls = "ok"; }
    const title = (n) => { const a = r.ach.find((x) => x.n === n); return a ? `${n} ${a.title}` : String(n); };
    const memLine = (label, m) => `<div class="kv"><span>${label}</span><b class="${m.fired.length ? "err" : ""}">${m.fired.length ? m.fired.length + " unlock" + (m.fired.length === 1 ? "" : "s") : m.readyHeld ? "ready holds" : "nothing"}</b></div>
      ${m.fired.length ? `<p class="note err">${m.fired.slice(0, 6).map((n) => esc(title(n))).join(", ")}${m.fired.length > 6 ? "…" : ""}</p>` : ""}`;
    $("#mkStatus").innerHTML = `<span class="verdict ${cls}" style="font-size:16px">${esc(verdict)}</span> <span class="muted">· ${counted.length} achievements · ${pts} points</span>${r.errors.length ? ` <button class="btn small" id="toChecks" style="margin-left:6px">See the lines</button>` : ""}`;
    if ($("#toChecks")) $("#toChecks").addEventListener("click", () => $("#checks").scrollIntoView({ behavior: "smooth" }));
    $("#checksDyn").innerHTML = `
      <div class="verdict ${cls}">${esc(verdict)}</div>
      ${r.errors.length ? `<ul class="elist">${r.errors.map((e) => `<li data-go="${e.line}"><b>${e.line}</b>${esc(e.msg)}<code>${esc(e.text)}</code></li>`).join("")}</ul>` : ""}
      <div class="kv" style="margin-bottom:12px">
        <span>Game</span><b>${esc(r.game || "–")}</b>
        <span>Achievements counted</span><b>${counted.length}</b>
        ${listed ? `<span>Listed, cannot unlock</span><b>${listed}</b>` : ""}
        <span>Points</span><b>${pts}</b>
        ${ids.size !== r.ach.length ? `<span class="err">Numbers used twice</span><b class="err">${r.ach.length - ids.size}</b>` : ""}
      </div>
      <h3>Emblem's limits</h3>
      ${LIMITS.map(([k, label, max]) => `<div class="lim"><span>${label}</span><span class="num">${(lim[k] || 0).toLocaleString("en-GB")} / ${max.toLocaleString("en-GB")}</span><div class="meter ${lim[k] > max ? "red" : lim[k] > max * 0.8 ? "gold" : "green"}"><i style="width:${Math.min(100, ((lim[k] || 0) / max) * 100)}%"></i></div></div>`).join("")}
      <h3 style="margin-top:14px">Empty memory test</h3>
      <p class="note">Three seconds of play over memory that is all zeros, then all 0xFF, as the guide asks. Nothing should unlock.</p>
      ${memLine("All zeros", mem.zero)}${memLine("All 0xFF", mem.ff)}
      ${readyWeak && !memBad ? `<p class="note" style="color:var(--gold)">ready holds on empty memory. Nothing unlocked, but a narrower ready is safer.</p>` : ""}
`;
    for (const li of document.querySelectorAll("#checksDyn [data-go]")) li.addEventListener("click", () => goLine(+li.dataset.go));
    drawDump();
  }

  function drawDump() {
    const el = $("#dumpOut");
    if (!el || !dump) return;
    const r = result;
    const title = (n) => { const a = r.ach.find((x) => x.n === n); return a ? `${n} ${a.title}` : String(n); };
    el.innerHTML = `
        ${dump ? `<p class="small" style="margin-top:8px">${esc(dump.name)}, from ${dump.base === 0x08000000 ? "0x08000000" : "0x08800000"}</p>
          <div class="kv"><span>ready held</span><b>${dump.res.readyHeld ? "yes" : "no"}</b><span>Would unlock</span><b>${dump.res.fired.length}</b></div>
          ${dump.res.fired.length ? `<p class="note">${dump.res.fired.map((n) => esc(title(n))).join(", ")}</p>` : ""}
          ${dump.res.show.length ? `<div class="kv" style="margin-top:6px">${dump.res.show.map((s) => `<span>${esc(s.name)}</span><b>${s.value}</b>`).join("")}</div>` : ""}` : ""}
`;
  }

  // the helpers under the checks: drawn once, so what is typed in them stays
  function drawHelpers() {
    $("#checksHelp").innerHTML = `
      <details><summary>Try a memory dump</summary>
        <p class="note">A dump of the game's RAM from an emulator: 24 MB starting at 0x08800000, or 32 MB from 0x08000000. The file runs for three seconds of game time and shows what would unlock.</p>
        <label class="btn small">Pick a dump<input type="file" id="dumpPick" class="hide"></label>
        <div id="dumpOut"></div>
      </details>
      <details><summary>RetroAchievements addresses</summary>
        <p class="note">Emblem's address is RetroAchievements' address plus 0x08000000.</p>
        <label class="f">RA address<input class="inp mono" id="raAddr" placeholder="0xbb9b30" autocomplete="off"></label>
        <p class="small" id="raOut" style="margin-top:6px"></p>
        <p class="note" style="margin-top:10px">Paste a game's code notes (the JSON from <code>retroachievements.org/dorequest.php?r=codenotes2&amp;g=…</code>) to pick values from them.</p>
        <textarea class="inp mono" id="raNotes" rows="3" placeholder='{"CodeNotes":[{"Address":"0x00bb9b30","Note":"[32-bit] Level"}]}'></textarea>
        <input class="inp" id="raFind" placeholder="Search the notes" style="margin-top:6px">
        <div class="notes" id="raList"></div>
      </details>
      <details><summary>The rule words</summary>${REF}</details>`;
    $("#dumpPick").addEventListener("change", pickDump);
    $("#raAddr").addEventListener("input", raConvert);
    $("#raNotes").addEventListener("input", raNotes);
    $("#raFind").addEventListener("input", raDraw);
  }

  async function pickDump(e) {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size < 0x1800000 - 4096) { App.toast("That is smaller than 24 MB: not a RAM dump"); return; }
    const bytes = new Uint8Array(await f.arrayBuffer());
    dump = { name: f.name, bytes, base: f.size >= 0x2000000 ? 0x08000000 : 0x08800000 };
    check();
  }

  // ---- RetroAchievements helpers -------------------------------------------------------------
  let notes = [], notesRaw = "";
  function raConvert() {
    const v = $("#raAddr").value.trim().replace(/^0x/i, "");
    const out = $("#raOut");
    if (!/^[0-9a-f]{1,8}$/i.test(v)) { out.textContent = ""; return; }
    const psp = (parseInt(v, 16) + 0x08000000) >>> 0;
    const hex = psp.toString(16).toUpperCase().padStart(8, "0");
    out.innerHTML = `Emblem address: <code style="font-family:var(--mono);color:var(--amber)">${hex}</code> ${psp < 0x08800000 || psp > 0x09ffffff ? `<span class="err">(outside the game's RAM: Emblem reads 0 there)</span>` : ""}`;
  }
  function raNotes() {
    notesRaw = $("#raNotes").value;
    notes = [];
    try {
      const j = JSON.parse(notesRaw);
      const arr = Array.isArray(j) ? j : j.CodeNotes || j.codeNotes || j.notes || Object.values(j).find(Array.isArray) || [];
      for (const n of arr) {
        const a = n.Address || n.address, t = n.Note || n.note || "";
        if (!a || !t) continue;
        const addr = (parseInt(String(a).replace(/^0x/i, ""), 16) + 0x08000000) >>> 0;
        const size = /\[\s*float/i.test(t) ? "float" : /\[\s*(32|24)[- ]?bit/i.test(t) ? "u32" : /\[\s*16[- ]?bit/i.test(t) ? "u16" : "u8";
        notes.push({ addr, hex: addr.toString(16).toUpperCase().padStart(8, "0"), size, note: t });
      }
    } catch (e) { /* not JSON yet */ }
    raDraw();
  }
  function raDraw() {
    const q = ($("#raFind") || {}).value ? $("#raFind").value.toLowerCase() : "";
    const list = notes.filter((n) => !q || n.note.toLowerCase().includes(q) || n.hex.toLowerCase().includes(q)).slice(0, 200);
    const el = $("#raList");
    if (!el) return;
    el.innerHTML = notes.length ? `<table>${list.map((n, i) => `<tr><td>${n.hex}<br><span class="muted">${n.size}</span></td><td>${esc(n.note.split("\n")[0].slice(0, 120))}</td><td><button class="btn small" data-use="${notes.indexOf(n)}">Use</button></td></tr>`).join("")}</table>` : "";
    for (const b of el.querySelectorAll("[data-use]")) b.addEventListener("click", () => {
      const n = notes[+b.dataset.use];
      const words = n.note.replace(/\[[^\]]*\]/g, " ").toLowerCase().match(/[a-z][a-z0-9]*/g) || ["value"];
      let name = words.slice(0, 2).join("_").slice(0, 20) || "value";
      const used = new Set(lines().map(classify).filter((x) => x.kind === "def").map((x) => x.name));
      if (/^(and|or|not|set|off|list|count|all|run|from|to|unless|cancel|grace|within|just|was|moved|drops|rises|changes|when|show|game|bit|u8|u16|u32|s32|float)$/.test(name)) name += "_v";
      let k = 2, base = name; while (used.has(name)) name = `${base}${k++}`;
      const xs = lines().map(classify);
      let at = -1; for (let i = xs.length - 1; i >= 0; i--) if (xs[i].kind === "def" || xs[i].kind === "show") { at = i; break; }
      if (at < 0) at = xs.findIndex((x) => x.kind === "game");
      insertAt(at + 1, `${name} = ${n.size} ${n.hex}   # ${n.note.split("\n")[0].replace(/#/g, "").slice(0, 80)}`);
      showSub("names");
      App.toast(`Added ${name}`);
    });
  }

  const REF = `<dl class="ref">
    <dt><code>u8 u16 u32 s32 float ADDR [bit N]</code></dt><dd>A value. Addresses in hex without 0x.</dd>
    <dt><code>== != &lt; &lt;= &gt; &gt;=  A..B</code></dt><dd>Tests; <code>A..B</code> includes both ends.</dd>
    <dt><code>set  off</code></dt><dd>set: not 0 and not all ones (games keep "not had" as -1). Use for flags and items.</dd>
    <dt><code>and or not ( )</code></dt><dd><code>and</code> binds tighter than <code>or</code>.</dd>
    <dt><code>list u8 ADDR ADDR …</code>, <code>count L</code>, <code>all L</code></dt><dd>A list of addresses of one type.</dd>
    <dt><code>X drops [N]  X rises [N]  X changes</code></dt><dd>Over time: compared with a tick ago (60 a second).</dd>
    <dt><code>just R  was X  R within 3s</code></dt><dd>Just became true; the value a tick ago; true for a while after.</dd>
    <dt><code>run from R to R [unless R] [cancel R] [grace 0.5s]</code></dt><dd>A challenge from A to B without C. <code>moved X</code> inside it: changed since the start.</dd>
    <dt><code>when R</code></dt><dd>The lines below are only looked at while R holds.</dd>
    <dt><code>none</code></dt><dd>Listed, cannot unlock; not counted.</dd>
  </dl><p class="note">The full guide: <a href="https://github.com/00KAM1/psp-ark-plugins/blob/main/docs/emblem-adding-games.md">Emblem: adding a game</a>.</p>`;

  // ---- toolbar ---------------------------------------------------------------------------
  $("#mkNew").addEventListener("click", () => open(TEMPLATE, "A new file"));
  $("#mkCopy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(text); App.toast("Copied"); }
    catch (e) { showSub("text"); ta.focus(); ta.select(); App.toast("Selected: copy it from here"); }
  });
  $("#mkSave").addEventListener("click", () => {
    const id = (result && result.game) || "game";
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url; a.download = id + ".txt"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    App.toast(`${id}.txt goes in ms0:/EMBLEM/games/`);
  });

  // ---- open ----------------------------------------------------------------------------
  const op = $("#opener");
  function drawOpen() {
    const q = $("#opSearch").value.toLowerCase();
    const hit = (id, t) => !q || id.toLowerCase().includes(q) || t.toLowerCase().includes(q);
    const rel = Object.entries(window.EMBLEM_RELEASE || {}).map(([id, t]) => ({ id, title: (RX.game.exec(t.split("\n").find((l) => RX.game.test(l)) || "") || [])[2] || id, t }));
    rel.sort((a, b) => a.title.localeCompare(b.title));
    $("#opRelease").innerHTML = rel.filter((r) => hit(r.id, r.title)).map((r) => `<li><button data-rel="${esc(r.id)}"><code>${esc(r.id)}</code><span>${esc(r.title)}</span><span></span></button></li>`).join("");
    const mine = App.stick && !App.sample ? App.stick.list("EMBLEM/games").files : [];
    $("#opStickH").hidden = !mine.length; $("#opStick").hidden = !mine.length;
    $("#opStick").innerHTML = mine.map((f) => {
      const id = f.path.split("/").pop().replace(/\.txt$/i, "");
      const g = App.model && App.model.games.get(id.toUpperCase());
      return hit(id, g ? g.title : "") ? `<li><button data-stick="${esc(f.path)}"><code>${esc(id)}</code><span>${esc(g ? g.title : "")}</span><span class="note">${g && g.earned.length ? g.earned.length + " earned" : ""}</span></button></li>` : "";
    }).join("");
    for (const b of op.querySelectorAll("[data-rel]")) b.addEventListener("click", () => { open(window.EMBLEM_RELEASE[b.dataset.rel], "Opened " + b.dataset.rel); op.close(); });
    for (const b of op.querySelectorAll("[data-stick]")) b.addEventListener("click", async () => { open(await App.stick.text(b.dataset.stick), "Opened from your Memory Stick"); op.close(); });
  }
  $("#mkOpen").addEventListener("click", () => { drawOpen(); op.showModal ? op.showModal() : op.setAttribute("open", ""); });
  $("#opClose").addEventListener("click", () => op.close());
  $("#opSearch").addEventListener("input", drawOpen);
  $("#pickTxt").addEventListener("change", async (e) => { const f = e.target.files[0]; if (f) { open(await f.text(), "Opened " + f.name); op.close(); } });

  // start: the draft from last time, or the fullest example in the release
  App.startMaker = function () {
    drawHelpers();
    let draft = null;
    try { draft = localStorage.getItem(DRAFT); } catch (e) { /* none */ }
    open(draft || (window.EMBLEM_RELEASE || {}).ULUS10558 || TEMPLATE);
  };
}
