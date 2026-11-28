/* Shelf Tools - Checkup: the page around src/checkup.js. Shows the report for whatever is loaded. */
{
  "use strict";
  const { $, esc } = App;
  const STATUS = { ok: ["OK", "green"], warn: ["Look at this", "gold"], bad: ["Will not work", "red"], none: ["Not found", "grey"] };
  const MARK = { bad: "!!", warn: "!", info: "i" };
  let report = null, shown = false, stale = true;

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  function note(n) {
    return `<li class="ck-${n.level}"><span class="ck-mark" aria-hidden="true">${MARK[n.level]}</span><div>${esc(n.text)}` +
      (n.fix ? `<div class="ck-fix">${esc(n.fix)}${n.link ? ` <a href="${esc(n.link)}" target="_blank" rel="noopener">Releases</a>` : ""}</div>` : n.link ? `<div class="ck-fix"><a href="${esc(n.link)}" target="_blank" rel="noopener">Releases</a></div>` : "") +
      (n.code ? `<div class="ck-code"><code>${esc(n.code)}</code><button class="btn small" data-copy="${esc(n.code)}">Copy</button></div>` : "") + "</div></li>";
  }
  function cardHTML(c) {
    // states that are refused or can bring old plugins back do work until one is loaded: the thing to do is delete them
    const s = c.off && c.status === "ok" ? ["Switched off", "grey"] : c.id === "states" && c.status === "bad" ? ["Delete these", "red"] : STATUS[c.status];
    return `<div class="card ck-card ck-is-${c.status}"><div class="ck-top"><h2>${esc(c.name)}${c.version ? ` <span class="ck-ver">${esc(c.version)}</span>` : ""}</h2><span class="tag ${s[1]}">${s[0]}</span></div>` +
      (c.facts.length ? `<p class="ck-facts">${c.facts.map((f) => `<span>${esc(f)}</span>`).join("")}</p>` : "") +
      (c.notes.length ? `<ul class="ck-notes">${c.notes.map(note).join("")}</ul>` : "") + "</div>";
  }
  function render() {
    const out = $("#ckOut"), r = report;
    $("#ckSample").hidden = !App.sample;
    if (!r) { out.innerHTML = ""; return; }
    if (!r.found) {
      out.innerHTML = `<div class="card"><h2>Nothing installed was found</h2><p class="muted" style="margin:6px 0 0">Checkup reads the plugin files in <code>SEPLUGINS</code>, ARK's files in <code>PSP/SAVEDATA/ARK_01234</code> and Shelf in <code>PSP/GAME/SHELF</code>. None of them was in what was loaded.</p>` +
        `<p class="muted" style="margin:8px 0 0"><b>Load your Memory Stick</b> and pick the drive itself (on a PS Vita, the <code>pspemu</code> folder). A zip or a drop of the five data folders alone does not hold them.</p></div>`;
      return;
    }
    const c = r.counts, here = r.cards.filter((x) => x.status !== "none"), gone = r.cards.filter((x) => x.status === "none");
    const verdict = c.bad ? `${plural(c.bad, "thing needs", "things need")} fixing` : c.warn ? "Nothing is broken" : "Everything checks out";
    const rest = [c.bad && c.warn ? `${c.warn} more to look at` : !c.bad && c.warn ? `${plural(c.warn, "thing", "things")} to look at` : "", c.info ? plural(c.info, "note", "notes") : ""].filter(Boolean).join(", ");
    out.innerHTML = `<div class="card ck-head ck-is-${c.bad ? "bad" : c.warn ? "warn" : "ok"}"><div><div class="ck-verdict">${verdict}</div>` +
      `<p class="muted small" style="margin:4px 0 0">${rest ? esc(rest.charAt(0).toUpperCase() + rest.slice(1)) + ". " : ""}${r.platform ? (r.platform === "vita" ? "PS Vita" : "PSP") + " builds. " : ""}${plural(here.length, "part", "parts")} looked at.</p></div>` +
      `<button class="btn" id="ckCopy">Copy the report</button></div>` +
      // two to a row, worst first; the two in a row are made the same height
      `<div class="ck-grid">${here.sort((a, b) => rank(a) - rank(b) || b.notes.length - a.notes.length).map(cardHTML).join("")}</div>` +
      (gone.length ? `<p class="muted small" style="margin:14px 0 0">Not found, which is fine if you do not use ${gone.length === 1 ? "it" : "them"}: ${gone.map((x) => esc(x.name)).join(", ")}.</p>` : "");
  }
  const rank = (c) => ({ bad: 0, warn: 1, ok: 2 })[c.status];

  async function check() {
    if (!App.stick) return;
    stale = false;
    try {
      report = await Checkup.run(App.stick, window.OFFICIAL_FILES, { sample: App.sample, extra: window.OFFICIAL_SAMPLE, label: App.stick.label, version: window.TOOLS_VERSION });
    } catch (e) {
      report = null;
      $("#ckOut").innerHTML = `<div class="card err">Checkup could not read this Memory Stick: ${esc(e && e.message || e)}</div>`;
      return;
    }
    render();
  }
  const copy = async (text, done) => {
    try { await navigator.clipboard.writeText(text); App.toast(done); }
    catch (e) { App.toast("The browser did not allow copying"); }
  };
  $("#ckOut").addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t) return;
    if (t.id === "ckCopy" && report) copy(report.text, "The report is copied");
    else if (t.dataset.copy) copy(t.dataset.copy, "The line is copied");
  });
  $("#ckLoad").addEventListener("click", () => $("#openStick").click());

  // The report is made when the tab is first looked at, and again for each Memory Stick loaded
  App.listeners.push(() => { stale = true; if (shown) check(); });
  App.onCheckup = () => { shown = true; if (stale) check(); };
  App.checkup = () => report;      // for the browser check
}
