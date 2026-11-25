/*
 * Shelf Tools - Recap's numbers, for one period (all time, a year or a month).
 *
 * Time played per game takes the larger of two counts:
 *  - Checkpoint: the "time played" in each journey line is a running total, so a
 *    period's share is the total at its end minus the total at its start. Time after
 *    the last line (the .TIM file is newer) goes to the period of the game's last activity.
 *  - Runtime: from each "start <game>" line in battery_use.log to the next start,
 *    power-on or the end of that power-on.
 * They count the same play from two sides, so they are not added together.
 */
(function (root) {
  "use strict";
  const DAY = 86400e3;
  const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const inP = (d, p) => !!d && (!p.from || d >= p.from) && (!p.to || d < p.to);

  function lastActivity(g) {
    let t = null;
    const see = (d) => { if (d && (!t || d > t)) t = d; };
    g.journey.forEach((j) => see(j.when)); g.earned.forEach((e) => see(e.when)); g.sessions.forEach((s) => see(s.end));
    g.versions.forEach((v) => see(v.when)); g.slots.forEach((s) => see(s.when)); see(g.launched);
    return t;
  }
  function firstActivity(g) {
    let t = null;
    const see = (d) => { if (d && (!t || d < t)) t = d; };
    g.journey.forEach((j) => see(j.when)); g.earned.forEach((e) => see(e.when)); g.sessions.forEach((s) => see(s.start));
    g.versions.forEach((v) => see(v.when)); g.slots.forEach((s) => see(s.when));
    return t;
  }

  // The periods the data covers: all time, each year, each month (newest first)
  function periods(model) {
    const months = new Set();
    for (const g of model.games.values()) {
      const t0 = firstActivity(g), t1 = lastActivity(g);
      for (const d of [t0, t1]) if (d) months.add(d.getFullYear() * 12 + d.getMonth());
      g.journey.forEach((j) => months.add(j.when.getFullYear() * 12 + j.when.getMonth()));
      g.sessions.forEach((s) => months.add(s.start.getFullYear() * 12 + s.start.getMonth()));
      g.earned.forEach((e) => e.when && months.add(e.when.getFullYear() * 12 + e.when.getMonth()));
    }
    model.powerOns.forEach((p) => months.add(p.start.getFullYear() * 12 + p.start.getMonth()));
    const list = [{ id: "all", label: "All time", from: null, to: null }];
    const ms = [...months].sort((a, b) => b - a);
    const years = [...new Set(ms.map((m) => Math.floor(m / 12)))];
    for (const y of years) list.push({ id: "y" + y, label: String(y), from: new Date(y, 0, 1), to: new Date(y + 1, 0, 1), year: y });
    const name = (m) => new Date(Math.floor(m / 12), m % 12, 1).toLocaleString("en-GB", { month: "long", year: "numeric" });
    for (const m of ms) list.push({ id: "m" + m, label: name(m), from: new Date(Math.floor(m / 12), m % 12, 1), to: new Date(Math.floor(m / 12), m % 12 + 1, 1), month: true });
    return list;
  }

  // Checkpoint minutes inside [from, to)
  function checkpointMinutes(g, p) {
    const totalMin = Math.round(g.playedSecs / 60);
    const js = g.journey.filter((j) => j.played != null);
    if (!p.from && !p.to) return Math.max(totalMin, js.length ? js[js.length - 1].played : 0);
    const at = (T) => { let v = 0; for (const j of js) { if (j.when < T) v = j.played; else break; } return v; };
    let m = (p.to ? at(p.to) : (js.length ? js[js.length - 1].played : 0)) - (p.from ? at(p.from) : 0);
    const last = js.length ? js[js.length - 1].played : 0;
    if (totalMin > last && inP(lastActivity(g), p)) m += totalMin - last;
    return Math.max(0, m);
  }
  function sessionMinutes(g, p) {
    let m = 0;
    for (const s of g.sessions) {
      const a = Math.max(s.start, p.from || s.start), b = Math.min(s.end, p.to || s.end);
      if (b > a) m += (b - a) / 60000;
    }
    return Math.round(m);
  }

  function compute(model, p) {
    const games = [...model.games.values()];
    const out = { period: p, games: [], days: new Map(), hours: new Array(24).fill(0), weekdays: new Array(7).fill(0), hourSource: "sessions" };

    for (const g of games) {
      const cp = checkpointMinutes(g, p), rt = sessionMinutes(g, p);
      const minutes = Math.max(cp, rt);
      const earned = g.earned.filter((e) => inP(e.when, p));
      const earnedBy = g.earned.filter((e) => e.when && (!p.to || e.when < p.to));
      const journey = g.journey.filter((j) => inP(j.when, p));
      const versions = g.versions.filter((v) => inP(v.when, p));
      const first = firstActivity(g);
      out.games.push({
        g, minutes, cp, rt, earned, journey, versions,
        points: earned.reduce((s, e) => s + e.points, 0),
        progress: g.emblem && g.emblem.total ? { got: earnedBy.length, total: g.emblem.total } : null,
        completed: inP(g.finished, p) ? g.finished : null,
        started: inP(first, p) ? first : null,
        active: minutes > 0 || earned.length > 0 || journey.length > 0 || versions.length > 0 || inP(g.finished, p),
      });
      // days: game minutes per day, from Runtime's sessions; for a game Runtime has not
      // seen, the journey's running total, whose growth since the line before goes on the line's day.
      const perDay = new Map();
      for (const s of g.sessions) {
        let a = new Date(Math.max(s.start, p.from || s.start)), b = new Date(Math.min(s.end, p.to || s.end));
        while (b > a) {
          const next = new Date(a.getFullYear(), a.getMonth(), a.getDate() + 1);
          const cut = next < b ? next : b;
          const k = dayKey(a);
          perDay.set(k, (perDay.get(k) || { rt: 0, cp: 0 })); perDay.get(k).rt += (cut - a) / 60000;
          for (let t = a.getTime(); t < cut.getTime(); t += 60000) { const d = new Date(t); out.hours[d.getHours()]++; }
          out.weekdays[(a.getDay() + 6) % 7] += (cut - a) / 60000;
          a = cut;
        }
      }
      let prev = 0;
      for (const j of g.journey) {
        if (j.played == null) continue;
        const grew = Math.max(0, j.played - prev); prev = j.played;
        if (!inP(j.when, p)) continue;
        const k = dayKey(j.when);
        perDay.set(k, perDay.get(k) || { rt: 0, cp: 0 }); perDay.get(k).cp += Math.min(grew, 16 * 60);
      }
      // a game Runtime has seen is counted by its sessions alone: a journey line written
      // after weeks away would otherwise put all of them on one day
      for (const [k, v] of perDay) out.days.set(k, (out.days.get(k) || 0) + (g.sessions.length ? v.rt : v.cp));
    }
    // no Runtime sessions at all: when you play, from the times things happened instead
    if (!out.hours.some((x) => x)) {
      out.hourSource = "events";
      for (const g of games) {
        for (const d of [...g.journey.map((j) => j.when), ...g.earned.map((e) => e.when), ...g.versions.map((v) => v.when)]) {
          if (!inP(d, p)) continue;
          out.hours[d.getHours()]++; out.weekdays[(d.getDay() + 6) % 7]++;
        }
      }
    }
    out.games.sort((a, b) => b.minutes - a.minutes || b.earned.length - a.earned.length);
    out.played = out.games.filter((x) => x.active);
    out.minutes = out.games.reduce((s, x) => s + x.minutes, 0);

    // achievements
    out.earned = out.games.flatMap((x) => x.earned.map((e) => ({ ...e, g: x.g }))).sort((a, b) => b.when - a.when);
    out.points = out.earned.reduce((s, e) => s + e.points, 0);
    out.earnedByGame = out.games.filter((x) => x.earned.length).sort((a, b) => b.earned.length - a.earned.length);

    // days
    const keys = [...out.days.keys()].filter((k) => out.days.get(k) >= 1).sort();
    out.activeDays = keys.length;
    let best = 0, run = 0, prevDay = null, bestEnd = null;
    for (const k of keys) {
      const d = new Date(k + "T12:00:00");
      run = prevDay && Math.round((d - prevDay) / DAY) === 1 ? run + 1 : 1;
      if (run > best) { best = run; bestEnd = d; }
      prevDay = d;
    }
    out.streak = best ? { days: best, end: bestEnd } : null;
    let busy = null;
    for (const [k, v] of out.days) if (!busy || v > busy.minutes) busy = { day: new Date(k + "T12:00:00"), minutes: Math.round(v) };
    out.busiest = busy;
    // latest night: the session that ran furthest past midnight (before 6 am)
    let late = null;
    for (const g of games) for (const s of g.sessions) {
      if (!inP(s.start, p)) continue;
      const e = s.end, h = e.getHours() + e.getMinutes() / 60;
      const score = h < 6 ? h + 24 : h;
      if (score >= 22 && (!late || score > late.score)) late = { score, when: e, g };
    }
    out.latest = late;

    // battery and time on (Runtime, or Shelf's own count)
    const pos = model.powerOns.filter((x) => inP(x.start, p));
    let drop = 0, dropHours = 0, longest = null;
    for (const x of pos) {
      if (x.from != null && x.to != null && x.to < x.from && x.on >= 20) { drop += x.from - x.to; dropHours += x.on / 60; }
      if (!longest || x.on > longest.on) longest = x;
    }
    out.power = {
      count: pos.length, on: pos.reduce((s, x) => s + x.on, 0), asleep: pos.reduce((s, x) => s + x.asleep, 0),
      perHour: dropHours >= 1 ? drop / dropHours : null, longest,
      charges: model.uses.filter((u) => inP(u.when, p) && u.charging).length,
    };

    // saves
    out.versions = out.games.reduce((s, x) => s + x.versions.length, 0);
    out.completed = out.games.filter((x) => x.completed).sort((a, b) => a.completed - b.completed);
    out.started = out.games.filter((x) => x.started).sort((a, b) => a.started - b.started);
    out.slots = games.flatMap((g) => g.slots.map((s) => ({ ...s, g }))).sort((a, b) => (b.when || 0) - (a.when || 0));
    out.slotBytes = out.slots.reduce((s, x) => s + x.size, 0);
    return out;
  }

  const api = { periods, compute, dayKey, firstActivity, lastActivity };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RecapStats = api;
})(typeof window !== "undefined" ? window : globalThis);
