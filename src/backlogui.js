/* Shelf Tools - the Backlog tab: what is being played, what to play next, and the series in order. */
{
  "use strict";
  const { $, esc } = App;
  const st = { lib: null, plan: null, picked: null, open: {} };
  // "Today" for the sample is the last day its play was written, so that it does not age
  function today() {
    if (!App.sample) return new Date();
    let last = 0;
    for (const g of st.lib.games) { if (g.last && g.last.getTime() > last) last = g.last.getTime(); if (g.finished && g.finished.getTime && g.finished.getTime() > last) last = g.finished.getTime(); }
    return last ? new Date(last + 3600 * 1000) : new Date();
  }
  // the page only shows: no queue, no lengths, nothing kept
  function replan() { st.plan = Backlog.plan(st.lib.games, window.SERIES.series, {}, today()); }

  const h = (x) => (x >= 10 ? Math.round(x) : Math.round(x * 10) / 10) + "h";
  const STATE = { done: ["Completed", "green"], playing: ["Playing", "blue"], paused: ["Started", "amber"], fresh: ["Not started", "grey"] };
  const icon = (r) => App.libraryIcon(r.g);
  function card(r) {
    const g = r.g;
    return `<div class="card bl-card">${icon(r)}<div class="bl-body"><div class="gname">${esc(g.title)}</div>` +
      `<div class="bl-sub">${h(r.hours)} played${g.last ? " · last " + esc(App.date(g.last)) : ""}${g.emblem && g.emblem.total ? ` · ${g.emblem.earned} of ${g.emblem.total} achievements` : ""}</div>` +
      (r.in ? `<div class="bl-sub">${esc(r.in.name)}</div>` : "") + `</div></div>`;
  }
  function row(r) {
    const g = r.g;
    return `<div class="bl-row${st.picked === r.key ? " picked" : ""}">${icon(r)}<div class="bl-body"><div class="gname">${esc(g.title)}${g.fav ? ' <span class="tag gold">★</span>' : ""}</div>` +
      `<div class="bl-sub">${r.reasons.length ? r.reasons.map(esc).join(" · ") : r.hours >= 0.17 ? h(r.hours) + " played" + (g.last ? ", last " + esc(App.date(g.last)) : "") : "Not started"}</div></div></div>`;
  }
  function fold(id, title, count, body, openFirst) {
    if (!count) return "";
    const open = st.open[id] !== undefined ? st.open[id] : !!openFirst;
    return `<details class="card bl-fold" data-fold="${id}"${open ? " open" : ""}><summary><h2>${title}</h2><span class="tag grey">${count}</span></summary>${body}</details>`;
  }

  function render() {
    const out = $("#blOut"), p = st.plan, lib = st.lib;
    $("#blSample").hidden = !App.sample;
    if (!lib || !lib.games.length) {
      out.innerHTML = `<div class="card"><h2>No games were found</h2><p class="muted" style="margin:6px 0 0">The Backlog plans from the games on the Memory Stick and how much each was played. <b>Load your Memory Stick</b> and pick the drive itself.</p></div>`;
      return;
    }
    const open = p.rows.filter((r) => r.state !== "done").length;
    const rows = (list) => `<div class="bl-list">${list.map(row).join("")}</div>`;
    out.innerHTML =
      `<div class="lb-tiles">` +
      [[p.playing.length, "playing now", p.pace !== null ? `about ${h(p.pace)} a week lately` : ""], [p.paused.length, "started and left", ""], [p.fresh.length, "never started", `${open} not completed`], [p.done.length, "completed", `of ${p.rows.length}`]].map(([n, l, s]) => `<div class="card lb-tile"><div class="lb-big">${n}</div><div class="lb-lab">${l}</div>${s ? `<div class="lb-sub">${s}</div>` : ""}</div>`).join("") + `</div>` +
      (p.playing.length ? `<h2 class="bl-h">Playing now</h2><div class="ck-grid">${p.playing.map(card).join("")}</div>` : "") +
      `<div class="bl-headrow"><h2 class="bl-h">Suggested next</h2><button class="btn small main" id="blPick" ${p.suggest.length ? "" : "disabled"}>Pick one for me</button></div>` +
      (p.suggest.length ? `<div class="card">${rows(p.suggest)}</div>` : `<p class="muted">Nothing stands out. Favourites, games you started and series all feed this list.</p>`) +
      (p.series.length ? `<h2 class="bl-h">Series, in order</h2><div class="ck-grid">${p.series.map((s) =>
        `<div class="card bl-series"><div class="gname">${esc(s.name)}${s.strict ? ' <span class="tag pink">One story</span>' : ""}</div>${s.note ? `<div class="bl-sub">${esc(s.note)}</div>` : ""}<ol>${s.entries.map((e) => {
          const r = e.row; if (!r) return `<li class="off"><span>${esc(e.title)}</span><span class="tag grey" title="Not on the Memory Stick">Not here</span></li>`;
          return `<li${s.next === r.key ? ' class="next"' : ""}><span>${esc(e.title)}</span><span class="tag ${STATE[r.state][1]}">${s.next === r.key && r.state === "fresh" ? "Next" : STATE[r.state][0]}</span></li>`;
        }).join("")}</ol></div>`).join("")}</div>` : "") +
      fold("paused", "Started and left", p.paused.length, rows(p.paused)) +
      fold("fresh", "Never started", p.fresh.length, rows(p.fresh)) +
      fold("done", "Completed", p.done.length, `<div class="bl-list">${p.done.map((r) => `<div class="bl-row">${icon(r)}<div class="bl-body"><div class="gname">${esc(r.g.title)}</div><div class="bl-sub">${h(r.hours)} played${r.g.finished && r.g.finished.getTime ? " · completed " + esc(App.date(r.g.finished)) : ""}</div></div></div>`).join("")}</div>`) +
      `<p class="small muted bl-foot">This page only shows: it changes nothing and keeps nothing. Completed and favourite are Shelf's marks; set them in Shelf.</p>`;
    App.libraryIcons(out, lib);
  }

  const out = $("#blOut");
  out.addEventListener("toggle", (e) => { const d = e.target; if (d.dataset && d.dataset.fold) st.open[d.dataset.fold] = d.open; }, true);
  out.addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t || t.id !== "blPick") return;
    // one of the best three, so that asking again can give another
    const top = st.plan.suggest.slice(0, 3), others = top.filter((r) => r.key !== st.picked), r = (others.length ? others : top)[Math.floor(Math.random() * (others.length || top.length))];
    st.picked = r.key; render();
    const el = out.querySelector(".bl-row.picked"); if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
    App.toast("Play " + r.g.title);
  });
  $("#blLoad").addEventListener("click", () => $("#openStick").click());

  async function open() {
    try {
      const lib = await App.library();
      if (!lib) return;
      if (st.lib !== lib) { st.lib = lib; st.picked = null; }
      replan(); render();
    } catch (e) { $("#blOut").innerHTML = `<div class="card err">The Backlog could not read this Memory Stick: ${esc(e && e.message || e)}</div>`; }
  }
  App.listeners.push(() => { st.lib = null; if (!$("#view-backlog").hidden) open(); });
  App.onBacklog = open;
  // a file found cut short changes the plan
  App.onLibraryChecked = () => { if (st.lib && !$("#view-backlog").hidden) { replan(); render(); } };
  App.backlogState = st;      // for the browser check
}
