/* Shelf Tools - Sync: the page around src/sync.js. Picks the two folders, shows the plan, runs it. */
{
  "use strict";
  const { $, esc } = App;
  // Writing into a picked folder needs the File System Access API: Chrome, Edge and other
  // Chromium browsers (Brave keeps it behind a flag). Without it the sample still shows how Sync works.
  const can = typeof window.showDirectoryPicker === "function" && !!(window.crypto && crypto.subtle);
  const st = { stick: null, vault: null, hStick: null, hVault: null, kind: "psp", sample: false, plan: null, result: null, busy: false, urls: [] };

  // ---- the two folders are remembered between visits (the browser asks again before use) ----
  const db = (mode, fn) => new Promise((ok, no) => {
    const r = indexedDB.open("shelf-tools", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("handles");
    r.onerror = () => no(r.error);
    r.onsuccess = () => { const tx = r.result.transaction("handles", mode), q = fn(tx.objectStore("handles")); tx.oncomplete = () => ok(q && q.result); tx.onerror = () => no(tx.error); };
  });
  const remember = (k, h) => db("readwrite", (s) => s.put(h, k)).catch(() => {});
  const recall = (k) => db("readonly", (s) => s.get(k)).catch(() => null);

  const say = (text, bad) => { const m = $("#syMsg"); m.textContent = text || ""; m.className = "small" + (bad ? " err" : " muted"); };
  const meter = (part) => { const m = $("#syMeter"); m.hidden = part == null; if (part != null) m.firstElementChild.style.width = Math.round(part * 100) + "%"; };
  function buttons() {
    const both = !!(st.stick && st.vault), P = st.plan;
    const n = P && !P.errors.length ? P.items.filter((it) => it.on && SyncCore.dirOf(it) !== "skip").length : 0;
    $("#syCompare").disabled = st.busy || !both;
    $("#sySync").disabled = st.busy || !P || !!P.errors.length || (!n && !P.firstSync);
    $("#sySync").textContent = n ? `Sync now (${n})` : "Sync now";
    for (const id of ["#syStick", "#syVault", "#syTry", "#syStickAgain", "#syVaultAgain"]) $(id).disabled = st.busy || (!can && id !== "#syTry");
    $("#syStickName").textContent = st.stick ? st.stick.label : "Not picked yet";
    $("#syStickName").className = "sy-name" + (st.stick ? "" : " none");
    $("#syVaultName").textContent = st.vault ? st.vault.label : "Not picked yet";
    $("#syVaultName").className = "sy-name" + (st.vault ? "" : " none");
    $("#syTry").textContent = st.sample ? "Start the sample again" : "Try it on the sample";
  }

  // ---- picking ---------------------------------------------------------------------------------
  const PLUGIN = ["PSP", "SIDEQUEST", "CHECKPOINT", "EMBLEM", "RUNTIME", "SHELF"];
  async function pick(which, again) {
    let h = again;
    try {
      if (!h) h = await window.showDirectoryPicker({ id: "shelf-" + which, mode: "readwrite" });
      else if ((await h.requestPermission({ mode: "readwrite" })) !== "granted") return;
    } catch (e) {
      if (!e || e.name !== "AbortError") say("That folder could not be opened: " + (e && e.message || e), true);
      return;
    }
    const other = which === "stick" ? st.hVault : st.hStick;
    if (other && !st.sample && (await h.isSameEntry(other))) { say("That is the folder already picked as the " + (which === "stick" ? "vault" : "Memory Stick") + ". The two must be different folders.", true); return; }
    if (st.sample) { st.sample = false; st.stick = st.vault = st.hStick = st.hVault = null; st.result = null; }
    let dir = new SyncDir.FsaDir(h, h.name);
    if (which === "stick") {
      st.kind = /^pspemu$/i.test(h.name) ? "vita" : "psp";
      const top = ((await dir.list("")) || []).filter((e) => e.dir).map((e) => e.name.toUpperCase());
      // a PS Vita's card: the Memory Stick is the pspemu folder on it
      if (!top.some((n) => PLUGIN.includes(n)) && top.includes("PSPEMU")) { dir = dir.sub("pspemu", h.name + "/pspemu"); st.kind = "vita"; }
      st.stick = dir; st.hStick = h;
    } else { st.vault = dir; st.hVault = h; }
    remember(which, h);
    $(which === "stick" ? "#syStickAgain" : "#syVaultAgain").hidden = true;
    st.plan = null; st.result = null;
    say("");
    if (st.stick && st.vault) await compare(); else { render(); buttons(); }
  }

  // ---- compare and sync -------------------------------------------------------------------------
  async function compare() {
    if (!st.stick || !st.vault || st.busy) return;
    st.busy = true; buttons(); say("Reading the Memory Stick…"); meter(0);
    try {
      const S = await SyncCore.scan(st.stick, "stick", (l, i, n, name) => { meter(n ? (i / n) * 0.6 : 0.6); say(`${l} on the Memory Stick… ${name || ""}`); });
      const V = await SyncCore.scan(st.vault, "vault", (l, i, n, name) => { meter(0.6 + (n ? (i / n) * 0.4 : 0.4)); say(`${l} in the vault… ${name || ""}`); });
      st.plan = SyncCore.plan(S, V);
      say("");
    } catch (e) {
      st.plan = null;
      say("That could not be read: " + (e && e.message || e), true);
    }
    st.busy = false; meter(null);
    const P = st.plan;
    if (P && !P.errors.length) {
      $("#syDevBox").hidden = false;
      const inp = $("#syDev");
      if (!inp.dataset.typed || P.device) inp.value = P.device ? P.device.name : st.sample ? "PSP-3000" : st.kind === "vita" ? "PS Vita" : "PSP";
    }
    render(); buttons();
  }
  async function sync() {
    const P = st.plan;
    if (!P || P.errors.length || st.busy) return;
    st.busy = true; buttons(); meter(0);
    try {
      const name = $("#syDev").value.trim().slice(0, 24) || (st.kind === "vita" ? "PS Vita" : "PSP");
      st.result = await SyncCore.apply(P, st.stick, st.vault, { deviceName: name, deviceKind: st.kind, now: st.sample ? SAMPLE_NOW : undefined,
        progress: (l, i, n, title) => { meter(n ? i / n : 1); say(`${l}… ${title || ""}`); } });
      App.toast(st.result.failed.length ? "Synced, with something left over" : st.sample ? "The sample is synced" : "Synced");
    } catch (e) {
      st.result = { error: e && e.message || String(e) };
    }
    st.busy = false; meter(null); say("");
    $("#syDev").dataset.typed = "";
    await compare();
  }

  // ---- showing the plan --------------------------------------------------------------------------
  const when = (ms) => (ms ? App.date(new Date(ms), true) : "");
  const hm = (secs) => (secs < 60 ? "under a minute" : App.hm(Math.round(secs / 60)));
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const said = (x) => { const t = x && x.sfo && (x.sfo.SAVEDATA_TITLE || x.sfo.SAVEDATA_DETAIL || "").split(/\r?\n/)[0].trim(); return t ? `“${t}”` : ""; };
  const TAG = { toVault: ["To the vault", "blue"], toStick: ["To this device", "green"], both: ["Both ways", "gold"], skip: ["Left as it is", "grey"] };

  function describe(it, P) {
    const d = SyncCore.dirOf(it), from = it.fromV ? ", from " + it.fromV : "";
    let what = "", why = "", care = "", tag = TAG[d] || TAG.skip;
    if (it.kind === "save" || it.kind === "emblem") {
      const save = it.kind === "save";
      // the save that would be kept: the one that moves, or for a choice, neither yet
      const moving = it.action === "conflict" ? null : d === "toVault" ? it.s : it.v;
      what = (save ? "Save " + esc(said(moving)) : "Emblem game file") + ` <code>${esc(it.name)}</code>`;
      const kept = " The copy it replaces is kept in the vault's history.";
      if (it.action === "toVault") why = it.why === "new" ? "Only on this device so far." : `Changed on this device${it.timeS ? " on " + when(it.timeS) : ""}.` + kept;
      else if (it.action === "toStick") why = it.why === "new" ? `Not on this device yet${from}.` : `Newer in the vault${from}${it.timeV ? ", " + when(it.timeV) : ""}. It replaces this device's ${save ? said(it.s) || "save" : "file"}.` + kept;
      else if (it.action === "gone") { why = "Removed from this device since the last sync. It stays in the vault. Tick it to put it back."; tag = ["Removed here", "grey"]; }
      else {
        why = it.cut ? "The last sync was cut short while this save was being copied here. The vault's copy is whole."
          : P.baseOk ? "Changed on this device and on another since the last sync. The one you do not take is kept in the vault's history."
          : "On both, and not the same. Nothing says which is newer but their dates. The one you do not take is kept in the vault's history.";
        tag = ["Your choice", "amber"];
      }
      if (it.slot && d === "toStick") care = `This device has a Sidequest ${it.slot.suspend ? "suspend" : "state"} of this game from ${esc(it.slot.when)}. Loading it carries on from before the save that arrives.`;
    } else if (it.kind === "earned") {
      what = "Achievements";
      const p = [];
      if (it.toS && it.m.addS) p.push(plural(it.m.addS, "achievement", "achievements") + " earned on another device");
      if (it.toV && it.m.addV) p.push(plural(it.m.addV, "achievement", "achievements") + " earned here");
      why = p.length ? p.join(", ") + "." : "The same achievements; the earlier dates are kept on both.";
    } else if (it.kind === "journey") {
      what = "Journey and time played";
      const p = [];
      if (it.toS && it.m.addS) p.push(plural(it.m.addS, "journey line", "journey lines") + " from another device");
      if (it.m.addV) p.push(plural(it.m.addV, "journey line", "journey lines") + " from here");
      if (it.toS && it.m.gainS > 0) p.push(hm(it.m.gainS) + " played elsewhere");
      if (it.m.gainV > 0) p.push(hm(it.m.gainV) + " played here");
      why = (p.length ? p.join(", ") + ". " : "") + `${hm(it.m.tim)} in all.`;
    } else if (it.kind === "marks") {
      what = "Favourites, completed and last started";
      const line = (c) => `${esc(c.title)}: ${esc(c.what.join(", ") || "noted")}`;
      const here = it.m.changes.filter((c) => c.to === "stick"), there = it.m.changes.filter((c) => c.to === "vault");
      const part = (list, label) => (list.length ? `<b>${label}</b> ` + list.slice(0, 6).map(line).join("; ") + (list.length > 6 ? `; and ${list.length - 6} more` : "") + ". " : "");
      why = part(here, "To this device:") + part(there, "To the vault:");
      tag = here.length && there.length ? TAG.both : here.length ? TAG.toStick : TAG.toVault;
      return { what, why, care, tag, html: true };
    } else if (it.kind === "runtime") {
      what = "Runtime's logs";
      why = `${plural(it.files.length, "file", "files")} copied to the vault, kept apart for each device. They describe this device's battery and are not sent to the others.`;
    }
    return { what, why, care, tag };
  }

  function row(it, P) {
    const d = describe(it, P), dir = SyncCore.dirOf(it), off = !it.on || dir === "skip";
    let extra = "";
    if (it.action === "conflict") {
      const o = (v, t) => `<option value="${v}"${it.choice === v ? " selected" : ""}>${esc(t)}</option>`;
      const mine = it.kind === "save" ? said(it.s) : "", theirs = it.kind === "save" ? said(it.v) : "";
      extra = `<select class="inp" data-choice="${it.n}" aria-label="Which copy to keep">` +
        o("stick", `Keep this device's ${mine}${it.timeS ? " · " + when(it.timeS) : ""}`) +
        o("vault", `Take the vault's ${theirs}${it.timeV ? " · " + when(it.timeV) : ""}${it.fromV ? " · from " + it.fromV : ""}`) +
        o("skip", "Leave both as they are for now") + "</select>";
    }
    const done = st.result && st.result.failed && st.result.failed.find((f) => f.kind === it.kind && f.key === it.key);
    return `<div class="sy-row${off ? " off" : ""}"><input type="checkbox" data-on="${it.n}"${it.on ? " checked" : ""} aria-label="Sync this">` +
      `<div class="what">${d.what}</div><span class="tag ${d.tag[1]}">${d.tag[0]}</span>` +
      `<div class="why">${d.html ? d.why : esc(d.why)}</div>${d.care ? `<div class="care">${d.care}</div>` : ""}${extra}` +
      (done ? `<div class="fail">Last time this failed: ${esc(done.error)}</div>` : "") + "</div>";
  }

  function resultCard() {
    const R = st.result;
    if (!R) return "";
    if (R.error) return `<div class="card sy-bad" style="margin-bottom:14px"><b class="err">The sync did not run.</b> ${esc(R.error)}</div>`;
    const sum = SyncCore.summary(R.counts);
    let h = `<div class="card${R.failed.length ? " sy-bad" : ""}" style="margin-bottom:14px"><b>${esc(R.device.name)} is synced${st.sample ? " (in the sample: nothing was written anywhere)" : ""}.</b> ${sum ? esc(sum.charAt(0).toUpperCase() + sum.slice(1)) + "." : "There was nothing to move."}`;
    if (R.failed.length) h += `<ul class="sy-notes err">` + R.failed.map((f) => `<li>${esc(f.title || f.key)} ${esc(f.name || "")}: ${esc(f.error)}</li>`).join("") + "</ul><p class=\"small muted\" style=\"margin:8px 0 0\">What failed is listed again below. Nothing was lost: a save that was being replaced is in the vault's history.</p>";
    if (R.stateError) h += `<p class="small err" style="margin:8px 0 0">${esc(R.stateError)}</p>`;
    return h + "</div>";
  }

  function devices(P) {
    const box = $("#syDevices");
    const ix = P && !P.errors.length ? (st.result && st.result.index) || P.V.state : null;
    if (!ix || !ix.devices || !Object.keys(ix.devices).length) { box.innerHTML = P && !P.errors.length && P.newVault ? '<p class="note" style="margin:12px 0 0">A new vault: this will be its first sync.</p>' : ""; return; }
    const me = P.device ? P.device.id : st.result && st.result.device ? st.result.device.id : "";
    box.innerHTML = '<div class="sy-dl">' + Object.entries(ix.devices).sort((a, b) => (a[1].synced < b[1].synced ? 1 : -1)).map(([id, d]) =>
      `<b>${esc(d.name)}${id === me ? ' <span class="tag green">this one</span>' : ""}</b><span>${plural(d.saves || 0, "save", "saves")}</span><span>synced ${esc(App.date(new Date(d.synced), true))}</span>`).join("") + "</div>";
  }

  function render() {
    const out = $("#syOut"), P = st.plan;
    for (const u of st.urls) URL.revokeObjectURL(u);
    st.urls = [];
    devices(P);
    if (!P) { out.innerHTML = resultCard(); return; }
    if (P.errors.length) { out.innerHTML = P.errors.map((e) => `<div class="card sy-bad" style="margin-bottom:10px"><b class="err">Not synced.</b> ${esc(e)}</div>`).join(""); return; }
    const groups = new Map();
    for (const it of P.items) {
      const k = it.game || it.kind;
      if (!groups.has(k)) groups.set(k, { key: k, title: it.title, items: [], game: !!it.game });
      groups.get(k).items.push(it);
    }
    const order = [...groups.values()].sort((a, b) => (a.game === b.game ? 0 : a.game ? -1 : 1) || (b.items.some((i) => i.action === "conflict") - a.items.some((i) => i.action === "conflict")) || a.title.localeCompare(b.title));
    const n = (f) => P.items.filter(f).length;
    const toV = n((i) => SyncCore.dirOf(i) === "toVault"), toS = n((i) => SyncCore.dirOf(i) === "toStick" && i.action !== "gone" && i.action !== "conflict"), both = n((i) => SyncCore.dirOf(i) === "both"), ask = n((i) => i.action === "conflict"), gone = n((i) => i.action === "gone");
    const same = P.same.save + P.same.emblem + P.same.earned + P.same.journey;
    let h = resultCard();
    for (const w of P.warnings) h += `<div class="card sy-warn" style="margin:0 0 12px">${esc(w)}</div>`;
    if (!P.items.length) {
      h += `<div class="card"><div class="sy-level">Everything is level.</div><p class="muted small" style="margin:6px 0 0">${plural(P.same.save, "save", "saves")}, ${plural(P.same.earned, "game's achievements", "games' achievements")} and ${plural(P.same.journey, "journey", "journeys")} are the same on this device and in the vault.` +
        (P.firstSync ? " This device has not been synced with the vault before: press Sync now once to make it known to the vault." : "") + "</p></div>";
    } else {
      h += '<div class="sy-sum">' + [[toV, "to the vault"], [toS, "to this device"], [both, "both ways"], [ask, "for you to choose"], [gone, "removed here"], [same, "already the same"]].filter((x) => x[0]).map((x) => `<span><b>${x[0]}</b>${x[1]}</span>`).join("") + "</div>";
      for (const g of order) {
        const head = g.game ? `<div class="sy-head" data-game="${esc(g.key)}">${App.gameIcon({ key: "", title: g.title, id: g.key })}<div class="gname">${esc(g.title)}<code>${esc(g.key)}</code></div></div>`
          : `<div class="sy-head" style="grid-template-columns:minmax(0,1fr)"><div class="gname">${esc(g.title)}</div></div>`;
        h += `<div class="sy-game">${head}${g.items.map((it) => row(it, P)).join("")}</div>`;
      }
    }
    if (P.notes.length) h += `<details><summary>Left alone (${P.notes.length})</summary><ul class="sy-notes">` + P.notes.map((x) => `<li>${esc(x)}</li>`).join("") + "</ul></details>";
    out.innerHTML = h;
    icons(P);
  }

  // A game's picture: Shelf's own icon of it on this device, or the icon inside one of its saves
  async function icons(P) {
    for (const el of $("#syOut").querySelectorAll(".sy-head[data-game]")) {
      const id = el.dataset.game;
      let url = null;
      try {
        const g = P.S.library.find((x) => x.id === id && x.iconKey != null);
        if (g) {
          const b = await st.stick.read(`SHELF/CACHE/${(g.iconKey >>> 0).toString(16).toUpperCase().padStart(8, "0")}.IMG`, 0, 8 + 144 * 80 * 2);
          if (b && b.length >= 8 + 144 * 80 * 2 && b[0] === 0x53 && b[1] === 0x48 && b[2] === 0x43 && b[3] === 0x31 && (b[4] & 1)) url = App.toURL(StickParse.rgb565(b, 144, 80, 8));
        }
        if (!url) for (const [dir, snap] of [[st.stick, P.S], [st.vault, P.V]]) {
          const s = [...snap.saves.values()].find((x) => x.key.startsWith(id) && x.icon);
          if (!s) continue;
          url = URL.createObjectURL(new Blob([await dir.read(s.icon)], { type: "image/png" }));
          st.urls.push(url);
          break;
        }
      } catch (e) { /* no picture: the initials stay */ }
      if (P !== st.plan) return;
      const ph = el.querySelector(".ph");
      if (!url || !ph) continue;
      const img = new Image();
      img.alt = ""; img.onload = () => ph.isConnected && ph.replaceWith(img); img.src = url;
    }
  }

  $("#syOut").addEventListener("change", (e) => {
    const P = st.plan, t = e.target;
    if (!P) return;
    if (t.dataset.on != null) P.items[+t.dataset.on].on = t.checked;
    else if (t.dataset.choice != null) { const it = P.items[+t.dataset.choice]; it.choice = t.value; it.on = true; }
    else return;
    const y = window.scrollY;
    render(); buttons();
    window.scrollTo(0, y);
  });
  $("#syDev").addEventListener("input", (e) => { e.target.dataset.typed = "1"; });
  $("#syStick").addEventListener("click", () => pick("stick"));
  $("#syVault").addEventListener("click", () => pick("vault"));
  $("#syCompare").addEventListener("click", () => { st.result = null; compare(); });
  $("#sySync").addEventListener("click", sync);
  $("#syTry").addEventListener("click", async () => {
    st.busy = true; buttons(); say("Setting up the sample…");
    try {
      const s = await sample();
      Object.assign(st, { stick: s.stick, vault: s.vault, hStick: null, hVault: null, sample: true, kind: "psp", plan: null, result: null });
      st.busy = false;
      $("#syDev").dataset.typed = "";
      await compare();
      say("This is the sample: a PSP and a vault that a PS Vita was synced with yesterday. Nothing is written anywhere.");
    } catch (e) { st.busy = false; say("The sample could not be set up: " + (e && e.message || e), true); buttons(); }
  });

  // ---- the sample: a PSP, and a vault a PS Vita has been synced with -----------------------------
  // Built by running Sync itself, in memory, so what it shows is what Sync would do: the
  // sample Memory Stick is synced, a PS Vita is, both are played on, the Vita is synced
  // again, and the page opens on the PSP being compared.
  const SAMPLE_NOW = "2026-11-24T23:00:00";
  async function sample() {
    const C = SyncCore, packed = await App.sampleFiles();
    const at = (s) => new Date(s).getTime(), mins = (s) => Math.round((at(s) - new Date(2000, 0, 1).getTime()) / 60000);
    const psp = new SyncDir.MemDir("Sample PSP"), vita = new SyncDir.MemDir("Sample PS Vita"), vault = new SyncDir.MemDir("Sample vault");
    for (const [p, [, , b64]] of Object.entries(packed)) {
      if (/^CHECKPOINT\/[^/]+\/\d{8}_/.test(p) || /\.(THM|PIN)$/i.test(p)) continue;          // save versions and slot pictures play no part
      const bin = atob(b64), b = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
      psp.put(p, b, at("2026-11-19T12:30:00"));
    }
    const text = async (d, p) => (await d.text(p)) || "";
    const lib = (await C.scan(psp, "stick")).library;
    const titleOf = (id) => (lib.find((g) => g.id === id) || {}).title || id;
    const save = (d, name, said, date, salt) => {
      const id = name.slice(0, 9);
      d.put(`PSP/SAVEDATA/${name}/PARAM.SFO`, C.sfoWrite({ CATEGORY: "MS", TITLE: titleOf(id), SAVEDATA_TITLE: said, SAVEDATA_DETAIL: said, SAVEDATA_DIRECTORY: name }), at(date));
      d.put(`PSP/SAVEDATA/${name}/DATA.BIN`, new TextEncoder().encode((name + " " + said + " " + (salt || "") + "\n").repeat(64)), at(date));
    };
    const line = async (d, id, date, total, said) => {
      const p = `CHECKPOINT/JOURNEY/${id}.TXT`;
      d.put(p, (await text(d, p)) + `${date.replace("T", " ").slice(0, 16)} | ${total} | ${said} | ${id}SAVE00\r\n`, at(date));
    };
    const mark = async (d, id, set) => {
      const g = lib.find((x) => x.id === id), ls = C.marksRead(await text(d, "SHELF/games.txt"));
      d.put("SHELF/games.txt", ls.map((l) => (l.path ? `${l.path} | ${l.path === g.path && set.launched ? set.launched : l.launched} | ${l.finished} | ${l.hidden} | ${l.pic} | ${l.path === g.path && set.fav != null ? set.fav : l.fav}` : l.raw) + "\r\n").join(""));
    };
    // every game with a journey has a save that says where it stands
    for (const g of lib) {
      const j = C.journeyRead(await text(psp, `CHECKPOINT/JOURNEY/${g.id}.TXT`)).list;
      if (g.id && j.length) save(psp, g.id + "SAVE00", j[j.length - 1].text, j[j.length - 1].stamp.replace(" ", "T") + ":00");
    }
    const run = async (S, V, name, now, id) => {
      S.now = V.now = () => at(now);
      const P = C.plan(await C.scan(S, "stick"), await C.scan(V, "vault"));
      await C.apply(P, S, V, { deviceName: name, now, deviceId: id, vaultId: "5a3d01c25a3d01c2", deviceKind: name === "PS Vita" ? "vita" : "psp" });
    };
    const runtime = [...psp.files.keys()].filter((p) => /^RUNTIME\//.test(p)).map((p) => [p, psp.files.get(p)]);
    for (const [p] of runtime) psp.files.delete(p);
    await run(psp, vault, "PSP-3000", "2026-11-19T22:00:00", "0c3000aa");
    // the PS Vita starts level with the vault ...
    for (const [p, f] of vault.files) if (!/^SYNC\//.test(p)) vita.put(p, f.bytes, f.mtime);
    for (const p of ["SHELF/CACHE/LIBRARY.BIN", "SHELF/games.txt"]) vita.put(p, psp.files.get(p).bytes, at("2026-11-19T22:00:00"));
    await run(vita, vault, "PS Vita", "2026-11-19T22:30:00", "71a2000b");
    // ... is played on: Ys goes on, a second Ys slot, an afternoon of Valkyria Chronicles 2, two achievements
    save(vita, "ULUS10558SAVE00", "Genos Island", "2026-11-23T20:40:00");
    save(vita, "ULUS10558SAVE01", "Clock Tower", "2026-11-21T21:20:00");
    await line(vita, "ULUS10558", "2026-11-21T21:14", "47h 40m", "Clock Tower");
    await line(vita, "ULUS10558", "2026-11-23T20:40", "49h 25m", "Genos Island");
    vita.put("CHECKPOINT/JOURNEY/ULUS10558.TIM", "178200\n");
    const have = C.earnedRead(await text(vita, "EMBLEM/earned/ULUS10558.txt"));
    const more = (await text(vita, "EMBLEM/games/ULUS10558.txt")).split(/\r?\n/).map((l) => /^(\d+)\s*\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|/.exec(l)).filter((m) => m && !have.byN.has(+m[1])).slice(0, 2);
    vita.put("EMBLEM/earned/ULUS10558.txt", (await text(vita, "EMBLEM/earned/ULUS10558.txt")) + more.map((m, i) => `${m[1]} | ${["2026-11-21 21:02", "2026-11-23 20:31"][i]} | ${m[2]} | ${m[3]} pts\r\n`).join(""));
    save(vita, "ULUS10515SAVE00", "Leanbluff", "2026-11-22T18:30:00");
    await line(vita, "ULUS10515", "2026-11-22T18:30", "12h 40m", "Leanbluff");
    vita.put("CHECKPOINT/JOURNEY/ULUS10515.TIM", "45900\n");
    await mark(vita, "ULUS10515", { fav: 1, launched: mins("2026-11-22T17:50:00") });
    await mark(vita, "ULUS10558", { launched: mins("2026-11-23T19:00:00") });
    await run(vita, vault, "PS Vita", "2026-11-23T21:00:00");
    // ... and so is the PSP, which has not been synced since
    save(psp, "ULUS10512SAVE00", "Tartarus Arqa", "2026-11-24T21:05:00");
    await line(psp, "ULUS10512", "2026-11-24T21:05", "62h 10m", "Tartarus Arqa");
    psp.put("CHECKPOINT/JOURNEY/ULUS10512.TIM", "224400\n");
    save(psp, "ULUS10515SAVE00", "Lanseal 2nd Term", "2026-11-23T13:02:00");
    await line(psp, "ULUS10515", "2026-11-23T13:02", "13h 05m", "Lanseal 2nd Term");
    psp.put("CHECKPOINT/JOURNEY/ULUS10515.TIM", "47400\n");
    await mark(psp, "ULUS10512", { launched: mins("2026-11-24T20:10:00") });
    await mark(psp, "ULUS10515", { launched: mins("2026-11-23T12:00:00") });
    for (const [p, f] of runtime) psp.put(p, f.bytes, f.mtime);
    psp.now = vault.now = () => at(SAMPLE_NOW);
    return { stick: psp, vault };
  }

  // ---- when the tab is first shown ------------------------------------------------------------------
  let shown = false;
  App.onSync = async () => {
    if (shown) return;
    shown = true;
    if (!can) {
      const need = $("#syNeed");
      need.hidden = false;
      need.innerHTML = "<b>This browser cannot write to folders,</b> which Sync needs. Use Chrome, Edge or another Chromium browser on a computer. In Brave, switch on <b>File System Access API</b> under <code>brave://flags</code> first. Recap and the Emblem Workshop work everywhere. You can still see how Sync works: <b>Try it on the sample</b>.";
    } else {
      // The folders picked last time are offered again. If reading them back ever stopped
      // the page (a note is left before trying and removed after), they are forgotten instead.
      const note = (v) => { try { if (v) localStorage.setItem("shelf-sync-recall", v); else localStorage.removeItem("shelf-sync-recall"); return localStorage.getItem("shelf-sync-recall"); } catch (e) { return null; } };
      let stuck = false;
      try { stuck = localStorage.getItem("shelf-sync-recall") === "trying"; } catch (e) { /* no storage: just try */ }
      if (stuck) { try { indexedDB.deleteDatabase("shelf-tools"); } catch (e) { /* nothing to forget */ } note(""); }
      else {
        note("trying");
        for (const which of ["stick", "vault"]) {
          const h = await recall(which);
          if (!h) continue;
          const b = $(which === "stick" ? "#syStickAgain" : "#syVaultAgain");
          b.hidden = false; b.textContent = `Use ${h.name} again`;
          b.onclick = () => pick(which, h);
        }
        note("");
      }
    }
    buttons();
  };
  App.sync = st;      // for the browser check
  buttons();
}
