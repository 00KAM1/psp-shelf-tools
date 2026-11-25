/* Shelf Tools - Recap: your PSP play for a period, from what the plugins kept. */
{
  "use strict";
  const { $, esc } = App;
  let model = null, periods = [], current = "all", stats = null;

  App.onModel((m) => {
    model = m;
    periods = RecapStats.periods(m);
    // open on the newest year that has data: a recap of the year
    const year = periods.find((p) => p.year);
    current = year && periods.filter((p) => p.year).length > 1 ? year.id : "all";
    if (!periods.find((p) => p.id === current)) current = "all";
    draw();
  });

  function chips() {
    const el = $("#periods");
    const top = periods.filter((p) => !p.month);
    const months = periods.filter((p) => p.month);
    const cur = periods.find((p) => p.id === current);
    el.innerHTML = top.map((p) => `<button class="chip" aria-pressed="${p.id === current}" data-p="${p.id}">${esc(p.label)}</button>`).join("") +
      (months.length ? `<select class="chip" id="monthPick" aria-label="A month" aria-pressed="${!!(cur && cur.month)}"><option value="">A month…</option>${months.map((p) => `<option value="${p.id}" ${p.id === current ? "selected" : ""}>${esc(p.label)}</option>`).join("")}</select>` : "");
    for (const b of el.querySelectorAll("button")) b.addEventListener("click", () => { current = b.dataset.p; draw(); });
    const sel = $("#monthPick");
    if (sel) sel.addEventListener("change", () => { if (sel.value) { current = sel.value; draw(); } });
  }

  const pl = (n, one, many) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many || one + "s"}`;
  const pct = (a, b) => (b ? Math.max(1.5, Math.min(100, (a / b) * 100)) : 0);

  function draw() {
    chips();
    const p = periods.find((x) => x.id === current) || periods[0];
    stats = RecapStats.compute(model, p);
    const s = stats;
    const host = $("#recapBody");
    if (!s.played.length && !s.power.count) {
      host.innerHTML = `<div class="band"><div class="wrap card"><h2>Nothing yet for ${esc(p.label)}</h2><p class="muted">Nothing on this Memory Stick says a game was played in this period. Recap needs at least one of Checkpoint's journey, Emblem's earned list, Runtime's logs or Shelf's notes.</p></div></div>`;
      return;
    }
    const title = p.id === "all" ? "Your PSP so far" : `${p.label} on your PSP`;
    const top = s.games.filter((x) => x.minutes > 0).slice(0, 5);
    const maxMin = top.length ? top[0].minutes : 1;
    host.innerHTML = `
    <div class="band" style="padding-top:12px">
      <div class="wrap hero">
        <div>
          <h1>${esc(title)}</h1>
          <div class="big" style="margin-top:18px">${App.hours(s.minutes)}<small>hours played</small></div>
          <div class="stats">
            <div class="stat"><b>${s.played.length}</b><span>${s.played.length === 1 ? "game" : "games"} played</span></div>
            <div class="stat"><b>${s.earned.length}</b><span>achievements</span></div>
            <div class="stat"><b>${s.activeDays}</b><span>days with play</span></div>
            <div class="stat"><b>${s.completed.length}</b><span>completed</span></div>
          </div>
          ${App.sample ? `<p class="sample">This is a made-up sample Memory Stick. Load yours to see your own.</p>` : ""}
        </div>
        <div class="shelf" aria-label="Your most played games">
          ${top.map((x, i) => `<div class="book ${i === 0 ? "first" : ""}" style="width:${shelfWidth(top, x)}%">${App.gameIcon(x.g)}<div class="rank"><b>${App.hours(x.minutes)}</b> h</div></div>`).join("") || `<p class="muted">No play time recorded in this period.</p>`}
        </div>
      </div>
    </div>
    <div class="band" style="padding-top:8px">
      <div class="wrap grid">
        ${topGames(s, maxMin)}
        ${whenYouPlay(s)}
        ${calendar(s, p)}
        ${achievements(s)}
        ${story(s)}
        ${finished(s)}
        ${records(s)}
        ${battery(s)}
        ${safety(s)}
        ${share()}
      </div>
    </div>`;
    App.fillIcons(host);
    const b = $("#makeShare");
    if (b) b.addEventListener("click", makeShare);
  }

  // the shelf: each game's width by its hours, the row filling about nine tenths of it
  function shelfWidth(top, x) {
    const max = top[0].minutes || 1;
    const w = (m) => 0.55 + 0.45 * (m / max);
    const sum = top.reduce((a, t) => a + w(t.minutes), 0);
    return Math.min(30, (w(x.minutes) / Math.max(sum, 3.2)) * 88).toFixed(1);
  }

  function topGames(s, maxMin) {
    const all = s.games.filter((x) => x.minutes > 0 || x.earned.length);
    const list = all.slice(0, 6);
    const rest = all.slice(6);
    return `<section class="card s7"><h2>Most played</h2>
      <div class="rows">${list.map((x) => `
        <div class="grow">${App.gameIcon(x.g)}
          <div><div class="gname">${esc(x.g.title)}${x.completed ? `<span class="tag green">Completed</span>` : ""}${x.g.fav ? `<span class="tag pink">Favourite</span>` : ""}</div>
          <div class="meter"><i style="width:${pct(x.minutes, maxMin)}%"></i></div>
          <div class="note">${[x.earned.length ? pl(x.earned.length, "achievement") : "", x.journey.length ? pl(x.journey.length, "journey entry", "journey entries") : ""].filter(Boolean).join(" · ") || esc(x.g.category || x.g.type || "")}</div></div>
          <div class="num">${App.hm(x.minutes)}</div>
        </div>`).join("") || `<p class="empty">No game time in this period.</p>`}</div>
      ${rest.length ? `<p class="note" style="margin-top:12px">And ${pl(rest.length, "more game")}, ${App.hm(rest.reduce((t, x) => t + x.minutes, 0))} between them.</p>` : ""}
    </section>`;
  }

  const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  function whenYouPlay(s) {
    const max = Math.max(1, ...s.hours);
    const topH = s.hours.indexOf(Math.max(...s.hours));
    const wmax = Math.max(1, ...s.weekdays);
    const topD = s.weekdays.indexOf(Math.max(...s.weekdays));
    const any = s.hours.some((x) => x);
    const ss = s.sessions;
    return `<section class="card s5"><h2>When you play</h2>
      ${any ? `<p class="muted">Your hour is <b style="color:var(--amber)">${String(topH).padStart(2, "0")}:00</b>, and your day is <b style="color:var(--ink)">${DAYS[topD]}</b>.</p>
      <div class="hours" role="img" aria-label="Play by hour of the day">${s.hours.map((v, i) => `<i class="${i === topH ? "peak" : ""}" style="height:${(v / max) * 100}%" title="${String(i).padStart(2, "0")}:00"></i>`).join("")}</div>
      <div class="axis"><span>00</span><span>06</span><span>12</span><span>18</span></div>
      <div class="week">${s.weekdays.map((v, i) => `<div><i><b style="height:${(v / wmax) * 100}%;${i === topD ? "background:var(--amber)" : ""}"></b></i>${DAYS[i].slice(0, 3)}</div>`).join("")}</div>
      ${ss ? `<div class="recs three" style="margin-top:16px">
        <div class="rec"><b>${ss.count}</b><span>sessions</span></div>
        <div class="rec"><b>${App.hm(ss.average)}</b><span>average</span></div>
        <div class="rec"><b>${App.hm(ss.longest)}</b><span>longest</span></div></div>` : ""}
      <p class="note" style="margin-top:12px">${s.hourSource === "sessions" ? "Minutes of play in each hour and on each day, from Runtime." : "When journey entries, unlocks and saves happened. With Runtime installed this shows minutes of play."}</p>`
      : `<p class="empty">Nothing dated in this period.</p>`}
    </section>`;
  }

  function level(v, max) { if (v < 1) return ""; const r = v / max; return r > 0.75 ? "l4" : r > 0.45 ? "l3" : r > 0.2 ? "l2" : "l1"; }
  const dayTitle = (k, v) => `${k}: ${v >= 1 ? App.hm(v) : "no play"}`;
  function calendar(s, p) {
    const max = Math.max(1, ...s.days.values());
    if (p.month) {
      const first = p.from, n = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
      const lead = (first.getDay() + 6) % 7;
      let cells = DAYS.map((d) => `<b>${d[0]}</b>`).join("");
      for (let i = 0; i < lead; i++) cells += `<i class="out"></i>`;
      for (let d = 1; d <= n; d++) {
        const k = RecapStats.dayKey(new Date(first.getFullYear(), first.getMonth(), d));
        const v = s.days.get(k) || 0;
        cells += `<i class="${level(v, max)}" title="${dayTitle(k, v)}">${d}</i>`;
      }
      // week by week: Monday to Sunday, the month's first and last weeks cut at its ends
      const weeks = [];
      for (let d = 1 - lead; d <= n; d += 7) {
        const a = Math.max(1, d), b = Math.min(n, d + 6);
        let mins = 0;
        for (let x = a; x <= b; x++) mins += s.days.get(RecapStats.dayKey(new Date(first.getFullYear(), first.getMonth(), x))) || 0;
        weeks.push({ label: a === b ? `${a}` : `${a} to ${b}`, mins });
      }
      const wmax = Math.max(1, ...weeks.map((w) => w.mins));
      const mon = first.toLocaleString("en-GB", { month: "short" });
      return `<section class="card s12"><h2>Your days</h2>
        <div class="cols">
          <div><div class="calm">${cells}</div>${legend()}
            <p class="note" style="margin-top:6px">${pl(s.activeDays, "day")} with play.</p></div>
          <div><h3>Week by week</h3><div class="rows">${weeks.map((w) => `<div><div class="lim" style="margin:0"><span>${w.label} ${mon}</span><span class="num">${App.hm(w.mins)}</span></div><div class="meter"><i style="width:${w.mins >= 1 ? pct(w.mins, wmax) : 0}%"></i></div></div>`).join("")}</div></div>
        </div></section>`;
    }
    // a year, or for all time the twelve months up to the last day with play: a column per week
    let end = p.to ? new Date(p.to.getTime() - 1) : null;
    if (!end) { const ks = [...s.days.keys()].sort(); end = ks.length ? new Date(ks[ks.length - 1] + "T12:00:00") : new Date(); }
    const from = p.from || new Date(end.getFullYear(), end.getMonth() - 11, 1);
    const start = new Date(from.getFullYear(), from.getMonth(), from.getDate() - ((from.getDay() + 6) % 7));
    let cells = "", shown = 0;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const k = RecapStats.dayKey(d), v = s.days.get(k) || 0;
      const out = d < from;
      if (!out && v >= 1) shown++;
      cells += `<i class="${out ? "out" : level(v, max)}" title="${out ? "" : dayTitle(k, v)}"></i>`;
    }
    return `<section class="card s12"><h2>Your days</h2><div class="cal">${cells}</div>${legend()}
      <p class="note" style="margin-top:6px">${pl(shown, "day")} with play${p.id === "all" ? " in these twelve months" : ""}. Each square is a day, with Monday at the top.</p></section>`;
  }
  const legend = () => `<div class="legend">Less <i style="background:var(--track)"></i><i style="background:#5a4a1e"></i><i style="background:#8a6a10"></i><i style="background:#c08a00"></i><i style="background:var(--amber)"></i> More</div>`;

  function achievements(s) {
    const latest = s.earned.slice(0, 5);
    const games = s.games.filter((x) => x.progress && (x.earned.length || x.minutes)).sort((a, b) => b.progress.got / b.progress.total - a.progress.got / a.progress.total).slice(0, 7);
    const best = s.earned.reduce((b, e) => (!b || e.points > b.points ? e : b), null);
    return `<section class="card s7"><h2>Achievements</h2>
      <div class="cols">
        <div>${s.earned.length ? `<div class="recs" style="margin-bottom:14px">
          <div class="rec"><b style="color:var(--gold)">${s.earned.length}</b><span>earned with Emblem</span></div>
          <div class="rec"><b style="color:var(--gold)">${s.points.toLocaleString("en-GB")}</b><span>points</span></div></div>
          <h3>Latest</h3><ul class="list">${latest.map((e) => `<li><span>${esc(e.title)}</span><span class="num" style="color:var(--gold)">${e.points}</span><span class="sub">${esc(e.g.title)} · ${App.date(e.when)}</span></li>`).join("")}</ul>`
        : `<p class="empty">No achievements earned in this period.</p>`}</div>
        <div>${games.length ? `<h3>Progress</h3><div class="rows">${games.map((x) => `<div><div class="lim" style="margin:0"><span class="gname">${esc(x.g.title)}</span><span class="num">${x.progress.got} / ${x.progress.total}</span></div><div class="meter gold"><i style="width:${pct(x.progress.got, x.progress.total)}%"></i></div></div>`).join("")}</div>` : `<p class="empty">No Emblem game files for the games played.</p>`}
        ${best ? `<p class="note" style="margin-top:14px">Biggest: <b style="color:var(--ink)">${esc(best.title)}</b>, ${best.points} points, in ${esc(best.g.title)}.</p>` : ""}</div>
      </div>
    </section>`;
  }

  function story(s) {
    const games = s.games.filter((x) => x.journey.length).slice(0, 4);
    return `<section class="card s5"><h2>Your journey</h2>
      ${games.length ? games.map((x) => {
        const j = x.journey, places = [];
        for (const e of j) if (places[places.length - 1] !== e.text) places.push(e.text);
        const shown = places.length > 4 ? [places[0], "…", places[places.length - 2], places[places.length - 1]] : places;
        return `<div class="trip"><div class="gname">${esc(x.g.title)}</div>
          <div class="path">${shown.map((t, i) => (t === "…" ? `<em>${places.length - 3} more</em>` : `<span>${esc(t)}</span>`) + (i < shown.length - 1 ? `<em>→</em>` : "")).join("")}</div>
          <div class="note" style="margin-top:4px">${App.date(j[0].when)} to ${App.date(j[j.length - 1].when)} · ${pl(j.length, "entry", "entries")}</div></div>`;
      }).join("") : `<p class="empty">No journey entries in this period. Checkpoint writes one each time a game's save says somewhere new.</p>`}
    </section>`;
  }

  function finished(s) {
    const started = s.started.filter((x) => !x.completed);
    const names = started.slice(0, 4).map((x) => esc(x.g.title)).join(", ") + (started.length > 4 ? ` and ${started.length - 4} more` : "");
    return `<section class="card s4"><h2>Completed</h2>
      ${s.completed.length ? `<ul class="list">${s.completed.slice(0, 5).map((x) => `<li><span class="gname">${esc(x.g.title)}</span><span class="when">${App.date(x.completed)}</span>${x.g.playedSecs ? `<span class="sub">${App.hm(x.g.playedSecs / 60)} in all</span>` : ""}</li>`).join("")}</ul>`
      : `<p class="empty">Nothing marked as completed in Shelf in this period.</p>`}
      ${started.length ? `<p class="note" style="margin-top:12px">Started and still going: ${names}.</p>` : ""}
    </section>`;
  }

  function records(s) {
    const r = [];
    const hhmm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    if (s.streak) r.push(`<div class="rec"><b>${pl(s.streak.days, "day")}</b><span>in a row, up to ${App.date(s.streak.end)}</span></div>`);
    if (s.busiest && s.busiest.minutes) r.push(`<div class="rec"><b>${App.hm(s.busiest.minutes)}</b><span>busiest day, ${App.date(s.busiest.day)}</span></div>`);
    if (s.latest) r.push(`<div class="rec"><b>${hhmm(s.latest.when)}</b><span>latest night, ${App.date(s.latest.when)}, ${esc(s.latest.g.title)}</span></div>`);
    if (s.power.longest) r.push(`<div class="rec"><b>${App.hm(s.power.longest.on)}</b><span>longest time switched on, ${App.date(s.power.longest.start)}</span></div>`);
    return `<section class="card s4"><h2>Records</h2>${r.length ? `<div class="recs">${r.join("")}</div>` : `<p class="empty">Not enough dated play for records.</p>`}</section>`;
  }

  function battery(s) {
    const pw = s.power;
    if (!pw.count) return `<section class="card s4"><h2>Battery</h2><p class="empty">No power-ons recorded in this period. The Runtime plugin keeps them.</p></section>`;
    const full = pw.perHour ? (100 / pw.perHour) * 60 : null;
    return `<section class="card s4"><h2>Battery</h2>
      <div class="recs">
        <div class="rec"><b>${pw.count}</b><span>times switched on</span></div>
        <div class="rec"><b>${App.hours(pw.on)} h</b><span>switched on</span></div>
        ${pw.asleep ? `<div class="rec"><b>${App.hours(pw.asleep)} h</b><span>asleep</span></div>` : ""}
        ${full ? `<div class="rec"><b style="color:var(--green)">${App.hm(full)}</b><span>from a full charge, at ${pw.perHour.toFixed(0)}% an hour</span></div>` : ""}
      </div>
    </section>`;
  }

  const SLOT = ["Suspend", "State 1", "State 2", "State 3", "State 4", "State 5"];
  function safety(s) {
    const slots = s.slots.slice(0, 6);
    return `<section class="card s12"><h2>Your safety net</h2>
      <div class="recs three" style="margin-bottom:16px">
        <div class="rec"><b style="color:var(--blue)">${s.versions}</b><span>save versions kept by Checkpoint from this period</span></div>
        <div class="rec"><b style="color:var(--blue)">${s.slots.length}</b><span>Sidequest slots on the Memory Stick now</span></div>
        ${s.slotBytes ? `<div class="rec"><b style="color:var(--blue)">${App.mb(s.slotBytes)}</b><span>taken up by those slots</span></div>` : ""}
      </div>
      ${slots.length ? `<div class="thumbs">${slots.map((x) => `<div class="thumb"><div class="badge">${x.thm ? `<img data-thumb="${esc(x.thm)}" alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">` : `<div class="nopic"></div>`}<span>${SLOT[x.k]}</span></div><div>${esc(x.g.title)}</div><small>${App.date(x.when, true)}</small></div>`).join("")}</div>` : ""}
    </section>`;
  }

  function share() {
    return `<section class="card s12"><h2>Share it</h2>
      <div class="sharebox"><div id="shareOut"><div class="shareph">1080 × 1350</div></div>
      <div><p class="muted">A picture of this period to post or keep: your hours, most played games, achievements and records. The game icons come from your own Shelf picture cache.</p>
        <div class="toolbar" id="shareBtns" style="margin:14px 0 0"><button class="btn main" id="makeShare">Make the picture</button></div>
        <p class="note" id="shareNote" hidden>On a phone, press and hold the picture to save it.</p></div></div>
    </section>`;
  }

  // ---- the picture ---------------------------------------------------------------------
  async function makeShare() {
    try { await drawShare(); } catch (e) { console.error(e); App.toast("The picture could not be made"); }
  }
  async function drawShare() {
    const s = stats, p = s.period;
    const W = 1080, H = 1350;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const x = c.getContext("2d");
    try { await document.fonts.load('40px "DotGothic16"'); } catch (e) { /* the plain font will do */ }
    const PIX = '"DotGothic16", "Inter", sans-serif', BODY = '"Inter", sans-serif';
    x.fillStyle = "#0e1116"; x.fillRect(0, 0, W, H);
    x.fillStyle = "#161a22"; x.fillRect(0, 0, W, 96);
    x.fillStyle = "#303846"; x.fillRect(0, 96, W, 2);
    x.fillStyle = "#ffb000"; x.font = `40px ${PIX}`; x.textBaseline = "middle"; x.fillText("SHELF", 56, 50);
    x.fillStyle = "#97a1b0"; x.textAlign = "right"; x.fillText(p.id === "all" ? "So far" : p.label, W - 56, 50); x.textAlign = "left";
    x.textBaseline = "alphabetic";
    x.fillStyle = "#ffb000"; x.font = `200px ${PIX}`; x.fillText(App.hours(s.minutes), 50, 330);
    x.fillStyle = "#eaecf0"; x.font = `48px ${PIX}`; x.fillText("hours played", 60, 400);
    const st = [[s.played.length, "games"], [s.earned.length, "achievements"], [s.activeDays, "days"], [s.completed.length, "completed"]];
    st.forEach(([v, l], i) => { const cx = 60 + i * 250; x.fillStyle = "#eaecf0"; x.font = `56px ${PIX}`; x.fillText(String(v), cx, 500); x.fillStyle = "#97a1b0"; x.font = `28px ${BODY}`; x.fillText(l, cx, 540); });
    x.fillStyle = "#303846"; x.fillRect(56, 590, W - 112, 2);
    x.fillStyle = "#97a1b0"; x.font = `32px ${PIX}`; x.fillText("Most played", 56, 650);
    const top = s.games.filter((g) => g.minutes > 0).slice(0, 4);
    for (let i = 0; i < top.length; i++) {
      const g = top[i], y = 690 + i * 120;
      const url = await App.iconURL(g.g);
      x.fillStyle = "#1b2029"; x.fillRect(56, y, 180, 100);
      if (url) { const img = new Image(); img.src = url; await img.decode().catch(() => {}); x.imageSmoothingEnabled = false; x.drawImage(img, 56, y, 180, 100); }
      else { x.fillStyle = "#323a4a"; x.fillRect(56, y, 180, 100); x.fillStyle = "#fff"; x.font = `40px ${PIX}`; x.textAlign = "center"; x.fillText(App.initials(g.g), 146, y + 64); x.textAlign = "left"; }
      x.strokeStyle = i === 0 ? "#ffb000" : "#343c4a"; x.lineWidth = 4; x.strokeRect(56, y, 180, 100);
      x.fillStyle = "#eaecf0"; x.font = `36px ${BODY}`;
      let t = g.g.title; while (x.measureText(t).width > 560 && t.length > 4) t = t.slice(0, -2);
      if (t !== g.g.title) t = t.trimEnd() + "…";
      x.fillText(t, 266, y + 48);
      x.fillStyle = "#97a1b0"; x.font = `28px ${BODY}`;
      x.fillText(g.earned.length ? `${g.earned.length} achievements` : (g.completed ? "Completed" : ""), 266, y + 88);
      x.fillStyle = i === 0 ? "#ffb000" : "#eaecf0"; x.font = `44px ${PIX}`; x.textAlign = "right"; x.fillText(App.hm(g.minutes), W - 56, y + 64); x.textAlign = "left";
    }
    const foot = [];
    if (s.streak && s.streak.days > 1) foot.push(`${s.streak.days} days in a row`);
    const topH = s.hours.indexOf(Math.max(...s.hours));
    if (s.hours.some((v) => v)) foot.push(`your hour: ${String(topH).padStart(2, "0")}:00`);
    if (s.points) foot.push(`${s.points} points`);
    x.fillStyle = "#303846"; x.fillRect(56, H - 150, W - 112, 2);
    x.fillStyle = "#deb846"; x.font = `34px ${PIX}`; x.fillText(foot.join("  ·  "), 56, H - 92);
    x.fillStyle = "#5e6878"; x.font = `24px ${BODY}`; x.fillText("Made with Shelf Tools · Shelf, Sidequest, Checkpoint, Emblem, Runtime", 56, H - 48);
    const url = c.toDataURL("image/png");
    const name = `shelf-recap-${p.id === "all" ? "so-far" : p.label.toLowerCase().replace(/\s+/g, "-")}.png`;
    $("#shareOut").innerHTML = `<img src="${url}" alt="Your Recap picture">`;
    $("#shareBtns").innerHTML = `<a class="btn main" href="${url}" download="${esc(name)}">Download</a><button class="btn" id="makeShare">Make it again</button>`;
    $("#shareNote").hidden = false;
    $("#makeShare").addEventListener("click", makeShare);
  }
}
