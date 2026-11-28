/* Shelf Tools - the Library tab and what it shares with the Backlog: the games of the loaded Memory Stick. It only shows. */
{
  "use strict";
  const { $, esc } = App;
  const st = { lib: null, stale: true, shown: false, show: "all", cat: "", sort: "title", find: "", checked: 0, toCheck: 0, urls: [] };
  const gb = (b) => (b == null ? "" : b >= 1073741824 ? (b / 1073741824).toFixed(b >= 10737418240 ? 0 : 1) + " GB" : Math.max(1, Math.round(b / 1048576)) + " MB");
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const hrs = (secs) => (secs >= 600 ? App.hm(secs / 60) : "");

  // The games of the loaded Memory Stick, built once for each one loaded. The Backlog asks for the same.
  let building = null;
  App.library = () => {
    if (!App.stick) return Promise.resolve(null);
    if (!st.stale && st.lib) return Promise.resolve(st.lib);
    if (!building) {
      building = Library.build(App.stick, App.model).then((lib) => {
        st.lib = lib; st.stale = false; st.checked = 0; st.toCheck = 0; building = null;
        // each image is checked for being whole after the list is up: one small read a game
        st.toCheck = lib.games.filter((g) => g.file && g.fmt !== "PBP" && g.fmt !== "DAX").length;
        const mine = lib;
        Library.check(lib, (n) => { if (st.lib === mine) { st.checked = n; if (st.shown) progress(); } }).then(() => { if (st.lib === mine) { lib.totals = Library.totals(lib.games); if (st.shown) render(); if (App.onLibraryChecked) App.onLibraryChecked(); } });
        return lib;
      }).catch((e) => { building = null; throw e; });
    }
    return building;
  };
  // The icon of a game: Shelf's own of it, or the one read out of the game's file
  App.libraryIcon = (g) => App.gameIcon({ key: g.inShelf ? g.key : "", title: g.title, id: g.id }, "") .replace("<span ", `<span data-own="${esc(g.path)}" `);
  App.libraryIcons = async (rootEl, lib) => {
    App.fillIcons(rootEl);
    for (const el of rootEl.querySelectorAll(".ph[data-own]")) {
      const g = lib.games.find((x) => x.path === el.dataset.own);
      if (!g || g.inShelf || !g.icon) continue;
      try {
        if (!g.iconURL) { const b = await g.icon(); if (b) { g.iconURL = URL.createObjectURL(new Blob([b], { type: "image/png" })); st.urls.push(g.iconURL); } }
        if (g.iconURL && el.isConnected) { const img = new Image(); img.alt = ""; img.src = g.iconURL; img.onload = () => el.isConnected && el.replaceWith(img); }
      } catch (e) { /* no picture: the initials stay */ }
    }
  };

  const FLAG = {
    cut: ["Cut short", "red"], dup: ["Twice", "gold"], gone: ["File gone", "gold"], new: ["Not in Shelf yet", "blue"],
    noicon: ["No icon", "grey"], unreadable: ["Unreadable", "red"], dax: ["DAX", "grey"],
  };
  function notes(lib) {
    const G = lib.games, by = (f) => G.filter((g) => g.flags.includes(f)), out = [];
    const names = (list) => list.slice(0, 4).map((g) => esc(g.title)).join(", ") + (list.length > 4 ? ` and ${list.length - 4} more` : "");
    const cut = by("cut"), bad = by("unreadable"), dup = by("dup"), gone = by("gone"), fresh = by("new"), noicon = by("noicon");
    for (const g of cut) out.push(["bad", `<b>${esc(g.title)}</b> is cut short: ${g.need ? `it should be ${gb(g.need)} and is ${gb(g.size)}` : esc(g.why)}. It will stop or crash where the file ends.`, "Copy it to the Memory Stick again."]);
    for (const g of bad) out.push(["bad", `<b>${esc(g.title)}</b> could not be read: ${esc(g.why || "")}.`, "Copy it again, or check the Memory Stick."]);
    const groups = new Map(); for (const g of dup) { if (!groups.has(g.id)) groups.set(g.id, []); groups.get(g.id).push(g); }
    for (const list of groups.values()) out.push(["warn", `<b>${esc(list[0].title)}</b> is on the Memory Stick ${list.length === 2 ? "twice" : list.length + " times"}: ${list.map((g) => `<code>${esc(g.path)}</code>`).join(" and ")}.`, `Removing one frees ${gb(Math.min(...list.map((g) => g.size || 0)))}.`]);
    if (gone.length) out.push(["warn", `Shelf lists ${plural(gone.length, "game", "games")} whose file is no longer there: ${names(gone)}.`, "In Shelf: Settings > Library > Rescan."]);
    if (fresh.length) out.push(["info", `Shelf has not scanned ${plural(fresh.length, "game", "games")} yet: ${names(fresh)}.`, "In Shelf: Settings > Library > Rescan."]);
    if (noicon.length) out.push(["info", `${plural(noicon.length, "game has", "games have")} no icon: ${names(noicon)}.`, ""]);
    const t = lib.totals;
    if (t.plain > 1) out.push(["info", `${plural(t.plain, "game is", "games are")} plain ISO, ${gb(t.plainBytes)} in all. As CSO or ZSO they take less room; that is done on a computer.`, ""]);
    if (lib.skipped.updates) out.push(["info", `${plural(lib.skipped.updates, "folder", "folders")} in PSP/GAME ${lib.skipped.updates === 1 ? "is an update or add-on, not a game, and is" : "are updates or add-ons, not games, and are"} left out.`, ""]);
    if (lib.skipped.notGames) out.push(["info", `${plural(lib.skipped.notGames, "disc image is", "disc images are")} not a game (a UMD video or music disc) and left out.`, ""]);
    return out;
  }

  function list(lib) {
    const q = st.find.trim().toLowerCase();
    let G = lib.games.filter((g) => {
      if (st.cat && (g.category || "(no folder)") !== st.cat) return false;
      if (q && !(g.title + " " + g.path + " " + g.id).toLowerCase().includes(q)) return false;
      const s = st.show;
      return s === "all" || (s === "played" && g.played >= 600) || (s === "never" && g.played < 600) || (s === "done" && g.finished) || (s === "fav" && g.fav) || (s === "hidden" && g.hidden) || (s === "flag" && g.flags.some((f) => f !== "dax"));
    });
    const by = { title: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }), size: (a, b) => (b.size || 0) - (a.size || 0), played: (a, b) => b.played - a.played,
                 last: (a, b) => (b.last ? b.last.getTime() : 0) - (a.last ? a.last.getTime() : 0), folder: (a, b) => (a.category || "").localeCompare(b.category || "") };
    return G.sort((a, b) => by[st.sort](a, b) || by.title(a, b));
  }
  function rowHTML(g) {
    const flags = g.flags.filter((f) => FLAG[f]).map((f) => `<span class="tag ${FLAG[f][1]}">${FLAG[f][0]}</span>`).join("");
    // Shelf's own marks, shown as they are: they are set in Shelf
    const marks = (g.fav ? '<span class="tag gold">★ Favourite</span>' : "") + (g.finished ? '<span class="tag green">Completed</span>' : "") + (g.hidden ? '<span class="tag grey">Hidden</span>' : "");
    return `<div class="lb-row${g.flags.includes("gone") ? " gone" : ""}">${App.libraryIcon(g)}` +
      `<div class="lb-name"><div class="gname">${esc(g.title)}${flags}</div><div class="lb-sub">${esc(g.path)}${g.id ? " · " + esc(g.id) : ""}</div></div>` +
      `<div class="lb-c lb-fmt">${esc(g.fmt === "PBP" ? g.type : g.fmt)}<span> · ${gb(g.size)}${hrs(g.played) ? " · " + hrs(g.played) : ""}</span></div><div class="lb-c lb-size">${gb(g.size)}</div>` +
      `<div class="lb-c lb-play">${hrs(g.played) || '<span class="muted">Not played</span>'}${g.last && g.played >= 600 ? `<div class="lb-sub">${esc(App.date(g.last))}</div>` : ""}</div>` +
      `<div class="lb-marks">${marks}</div></div>`;
  }

  function progress() {
    const el = $("#lbCheck");
    if (!el) return;
    el.textContent = st.toCheck && st.checked < st.toCheck ? `Checking that each game's file is whole: ${st.checked} of ${st.toCheck}` : "";
  }

  function render() {
    const out = $("#lbOut"), lib = st.lib;
    $("#lbSample").hidden = !App.sample;
    if (!lib) { out.innerHTML = ""; return; }
    if (!lib.games.length) {
      out.innerHTML = `<div class="card"><h2>No games were found</h2><p class="muted" style="margin:6px 0 0">The Library lists the games in <code>ISO</code> and <code>PSP/GAME</code>, and what Shelf has scanned. <b>Load your Memory Stick</b> and pick the drive itself (on a PS Vita, the <code>pspemu</code> folder).</p></div>`;
      return;
    }
    const t = lib.totals;
    const fmts = Object.entries(t.byFmt).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => `${v.n} ${k === "PBP" ? "EBOOT" : k}`).join(" · ");
    const tile = (big, label, sub) => `<div class="card lb-tile"><div class="lb-big">${big}</div><div class="lb-lab">${label}</div>${sub ? `<div class="lb-sub">${sub}</div>` : ""}</div>`;
    const N = notes(lib), cats = Object.keys(t.byCat).sort();
    const opt = (v, label, cur) => `<option value="${esc(v)}"${cur === v ? " selected" : ""}>${esc(label)}</option>`;
    const shown = list(lib);
    out.innerHTML =
      `<div class="lb-tiles">${tile(t.count, t.count === 1 ? "game" : "games", fmts)}${tile(lib.hasFiles ? gb(t.bytes) : "?", "on the Memory Stick", lib.hasFiles ? Object.entries(t.byCat).sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 3).map(([k, v]) => `${esc(k)} ${gb(v.bytes)}`).join(" · ") : "Sizes need the drive itself to be picked")}` +
      `${tile(t.played, "played", `${t.never} not started · ${App.hours(t.secs / 60)} hours in all`)}${tile(t.done, "completed", `${plural(t.favs, "favourite", "favourites")}`)}</div>` +
      (N.length ? `<div class="card lb-notes"><h2>Worth a look</h2><ul class="ck-notes">${N.map(([lvl, text, fix]) => `<li class="ck-${lvl}"><span class="ck-mark" aria-hidden="true">${lvl === "bad" ? "!!" : lvl === "warn" ? "!" : "i"}</span><div>${text}${fix ? `<div class="ck-fix">${fix}</div>` : ""}</div></li>`).join("")}</ul></div>` : "") +
      `<div class="lb-bar"><input class="inp" id="lbFind" type="search" placeholder="Find a game" value="${esc(st.find)}" aria-label="Find a game">` +
      `<select class="inp" id="lbShow" aria-label="Show">${[["all", "All games"], ["played", "Played"], ["never", "Not started"], ["done", "Completed"], ["fav", "Favourites"], ["hidden", "Hidden"], ["flag", "With a note"]].map(([v, l]) => opt(v, l, st.show)).join("")}</select>` +
      `<select class="inp" id="lbCat" aria-label="Folder">${opt("", "Every folder", st.cat)}${cats.map((c) => opt(c, `${c} (${t.byCat[c].n})`, st.cat)).join("")}</select>` +
      `<select class="inp" id="lbSort" aria-label="Sort by">${[["title", "By title"], ["size", "Largest first"], ["played", "Most played"], ["last", "Last played"], ["folder", "By folder"]].map(([v, l]) => opt(v, l, st.sort)).join("")}</select>` +
      `<span class="small muted" id="lbCount">${shown.length} of ${lib.games.length}</span></div>` +
      `<div class="small muted" id="lbCheck" style="min-height:1.4em"></div>` +
      `<div class="lb-list" id="lbList">${shown.map(rowHTML).join("") || '<p class="muted" style="padding:14px">No game matches.</p>'}</div>`;
    progress();
    App.libraryIcons(out, lib);
  }
  // only the list and its count, so that typing in the search box keeps its place
  function relist() {
    const lib = st.lib, shown = list(lib);
    $("#lbList").innerHTML = shown.map(rowHTML).join("") || '<p class="muted" style="padding:14px">No game matches.</p>';
    $("#lbCount").textContent = `${shown.length} of ${lib.games.length}`;
    App.libraryIcons($("#lbList"), lib);
  }

  $("#lbOut").addEventListener("input", (e) => { if (e.target.id === "lbFind") { st.find = e.target.value; relist(); } });
  $("#lbOut").addEventListener("change", (e) => {
    const t = e.target;
    if (t.id === "lbShow") st.show = t.value; else if (t.id === "lbCat") st.cat = t.value; else if (t.id === "lbSort") st.sort = t.value; else return;
    relist();
  });
  $("#lbLoad").addEventListener("click", () => $("#openStick").click());

  async function open() {
    st.shown = true;
    try { await App.library(); render(); }
    catch (e) { $("#lbOut").innerHTML = `<div class="card err">The Library could not read this Memory Stick: ${esc(e && e.message || e)}</div>`; }
  }
  App.listeners.push(() => { st.stale = true; st.lib = null; for (const u of st.urls) URL.revokeObjectURL(u); st.urls = []; if (!$("#view-library").hidden) open(); else st.shown = false; });
  App.onLibrary = open;
  App.libraryState = st;      // for the browser check
}
