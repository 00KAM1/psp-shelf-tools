/*
 * Shelf Tools - the Backlog: what to play next, from what the Memory Stick already knows.
 *
 *   plan(games, series, prefs, now)  ->  { playing, queue, suggest, paused, fresh, done, series, pace, ... }
 *
 * games are the Library's (src/library.js). Each is one of:
 *   done     marked completed in Shelf
 *   playing  played in the last 30 days
 *   paused   started, and not touched for more than 30 days
 *   fresh    under ten minutes of play
 * Nothing is fetched from anywhere. How long a game is, is only known if you say so
 * (prefs.length, hours a game); the rest comes from play time, dates, Shelf's marks and
 * the list of series in data/series.json.
 *
 * prefs, kept by the page in the browser: { queue: [keys], length: { key: hours },
 * skip: [keys], weekly: hours a week or 0 to measure it }.
 */
(function (root) {
  "use strict";

  const DAY = 24 * 3600 * 1000, STARTED = 600, RECENT = 30 * DAY;
  const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();

  function stateOf(g, now) {
    if (g.finished) return "done";
    if ((g.played || 0) < STARTED) return "fresh";
    return g.last && now - g.last.getTime() <= RECENT ? "playing" : "paused";
  }
  // Hours a week over the last four weeks, from Runtime's sessions; null with none to go by
  function pace(games, now) {
    let mins = 0, any = false;
    for (const g of games) for (const s of g.sessions || []) {
      if (!s.end || !s.mins) continue;
      any = true;
      if (now - s.end.getTime() <= 28 * DAY && s.end.getTime() <= now + DAY) mins += s.mins;
    }
    return any ? mins / 60 / 4 : null;
  }

  // Which entry of which series a game is: the last entry whose pattern is in its name
  function seriesOf(g, series) {
    const text = norm(g.title + " " + g.fileTitle + " " + (g.path || "").split("/").pop());
    for (let si = 0; si < series.length; si++) {
      const s = series[si];
      if ((s.not || []).some((p) => new RegExp("(^| )" + p + "( |$)", "u").test(text))) continue;
      let hit = -1;
      s.entries.forEach((e, i) => { if (e.match.some((p) => new RegExp("(^| )" + p + "( |$)", "u").test(text))) hit = i; });
      if (hit >= 0) return { series: si, entry: hit };
    }
    return null;
  }

  function plan(games, seriesList, prefs, nowDate) {
    prefs = prefs || {};
    const now = (nowDate || new Date()).getTime(), length = prefs.length || {}, skip = new Set(prefs.skip || []);
    const mine = games.filter((g) => !g.flags.includes("gone"));
    // one entry a game: the copies of a game (the same disc ID twice) are one thing to play
    const byKey = new Map();
    for (const g of mine) if (!byKey.has(g.key) || (g.played || 0) > (byKey.get(g.key).played || 0)) byKey.set(g.key, g);
    const rows = [...byKey.values()].map((g) => {
      const hours = (g.played || 0) / 3600, len = +length[g.key] || 0;
      return { g, key: g.key, state: stateOf(g, now), hours, length: len, left: len ? Math.max(0, len - hours) : null, reasons: [], score: 0, in: null };
    });
    const by = new Map(rows.map((r) => [r.key, r]));

    // ---- series -----------------------------------------------------------------------------
    const series = [];
    (seriesList || []).forEach((s, si) => {
      const entries = s.entries.map((e) => ({ title: e.title, row: null }));
      for (const r of rows) { const at = seriesOf(r.g, [s]); if (at) { entries[at.entry].row = entries[at.entry].row || r; r.in = { series: si, entry: at.entry, name: s.name }; } }
      if (entries.some((e) => e.row)) series.push({ name: s.name, note: s.note || "", strict: !!s.strict, entries });
    });
    // the first game of a series that is on the Memory Stick and not done is its "next"
    for (const s of series) {
      const owned = s.entries.filter((e) => e.row), next = owned.find((e) => e.row.state !== "done");
      s.next = next ? next.row.key : null;
      owned.forEach((e, i) => {
        const r = e.row, before = owned.slice(0, i).filter((x) => x.row.state !== "done");
        if (r.state === "done") return;
        // only a series that is one story holds a later game back
        if (before.length) { if (s.strict) { r.after = before[0].title; r.score -= 30; r.reasons.push(`${s.name}: ${before[0].title} comes first`); } }
        else if (i > 0) { r.score += s.strict ? 40 : 15; r.reasons.push(`Next in ${s.name}: you have finished ${owned[i - 1].title}`); }
      });
    }

    // ---- what speaks for each game -----------------------------------------------------------
    const ago = (d) => { const days = Math.round((now - d.getTime()) / DAY); return days < 60 ? `${days} days ago` : `${Math.round(days / 30)} months ago`; };
    for (const r of rows) {
      const g = r.g;
      if (r.state === "done" || r.state === "playing") continue;
      if (r.left !== null && r.left <= 5 && r.state === "paused") { r.score += 35; r.reasons.push(`Nearly done: about ${Math.max(1, Math.round(r.left))}h left`); }
      if (r.state === "paused" && r.hours >= 2) { r.score += 20 + Math.min(r.hours, 20) / 2; r.reasons.push(`You are ${Math.round(r.hours)}h in${g.last ? ", last played " + ago(g.last) : ""}`); }
      else if (r.state === "paused") { r.score += 8; r.reasons.push(`Started${g.last ? " " + ago(g.last) : ""}, then left`); }
      if (g.fav && r.state === "fresh") { r.score += 15; r.reasons.push("A favourite you have not started"); }
      if (r.length && r.length <= 12 && r.state === "fresh") { r.score += 10; r.reasons.push(`Short: about ${r.length}h`); }
      if (g.emblem && g.emblem.total && r.state === "fresh") { r.score += 5; r.reasons.push(`Has ${g.emblem.total} achievements to earn`); }
      if (g.flags.includes("cut")) { r.score -= 100; r.reasons = ["Its file is cut short: copy it again first"]; }
    }

    const title = (a, b) => a.g.title.localeCompare(b.g.title, undefined, { sensitivity: "base" });
    const queue = (prefs.queue || []).map((k) => by.get(k)).filter((r) => r && r.state !== "done");
    const queued = new Set(queue.map((r) => r.key));
    const open = rows.filter((r) => r.state !== "done" && r.state !== "playing" && !queued.has(r.key) && !skip.has(r.key));
    const suggest = open.filter((r) => r.score > 0).sort((a, b) => b.score - a.score || title(a, b)).slice(0, 8);
    const measured = pace(mine, now), weekly = +prefs.weekly > 0 ? +prefs.weekly : measured;
    const playing = rows.filter((r) => r.state === "playing").sort((a, b) => (b.g.last ? b.g.last.getTime() : 0) - (a.g.last ? a.g.last.getTime() : 0));
    // how long the games being played and the queue will take, where a length is known
    const ahead = [...playing, ...queue];
    const known = ahead.filter((r) => r.left !== null), hoursLeft = known.reduce((s, r) => s + r.left, 0);
    return {
      now: new Date(now), rows, playing, queue, suggest,
      paused: rows.filter((r) => r.state === "paused" && !queued.has(r.key)).sort((a, b) => (b.g.last ? b.g.last.getTime() : 0) - (a.g.last ? a.g.last.getTime() : 0)),
      fresh: rows.filter((r) => r.state === "fresh" && !queued.has(r.key)).sort(title),
      done: rows.filter((r) => r.state === "done").sort((a, b) => b.g.finished - a.g.finished),
      skipped: rows.filter((r) => skip.has(r.key) && r.state !== "done").sort(title),
      series, pace: measured, weekly,
      ahead: { games: ahead.length, known: known.length, hours: hoursLeft, weeks: weekly && known.length ? hoursLeft / weekly : null },
    };
  }
  // Games that would fit in the hours given: those with a length, by how much is left
  const fits = (p, hours) => p.rows.filter((r) => r.state !== "done" && r.left !== null && r.left > 0 && r.left <= hours).sort((a, b) => a.left - b.left);

  const api = { plan, fits, stateOf, pace, seriesOf, norm };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Backlog = api;
})(typeof window !== "undefined" ? window : globalThis);
