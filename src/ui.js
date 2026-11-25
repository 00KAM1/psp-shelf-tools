/* Shelf Tools - the page: tabs, loading a stick, shared helpers. */
{
  "use strict";
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const App = (window.App = {
    $, esc,
    stick: null, model: null, engine: null, sample: true,
    listeners: [],
    onModel(fn) { this.listeners.push(fn); },
    toast(msg) {
      const t = $("#toast");
      t.textContent = msg; t.classList.add("on");
      clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("on"), 2200);
    },
    hm(min) {
      min = Math.round(min || 0);
      const h = Math.floor(min / 60), m = min % 60;
      return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
    },
    hours(min) { const h = (min || 0) / 60; return h >= 100 ? Math.round(h).toLocaleString("en-GB") : h >= 10 ? h.toFixed(0) : h.toFixed(1).replace(/\.0$/, ""); },
    date(d, withTime) {
      if (!d) return "";
      const o = { day: "numeric", month: "short" };
      if (d.getFullYear() !== new Date().getFullYear()) o.year = "numeric";
      let s = d.toLocaleDateString("en-GB", o);
      if (withTime) s += " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
      return s;
    },
    mb(bytes) { return bytes >= 1024 ** 3 ? (bytes / 1024 ** 3).toFixed(1) + " GB" : Math.round(bytes / 1024 ** 2) + " MB"; },
    // RGBA picture -> data URL (cached by key)
    pics: new Map(),
    toURL(img) {
      const c = document.createElement("canvas");
      c.width = img.w; c.height = img.h;
      c.getContext("2d").putImageData(new ImageData(img.rgba, img.w, img.h), 0, 0);
      return c.toDataURL("image/png");
    },
    async iconURL(g) {
      if (g.iconKey == null || !this.stick) return null;
      const k = "i" + g.iconKey;
      if (!this.pics.has(k)) this.pics.set(k, StickParse.icon(this.stick, g.iconKey).then((i) => (i ? this.toURL(i) : null)).catch(() => null));
      return this.pics.get(k);
    },
    async thumbURL(path) {
      if (!this.stick) return null;
      const k = "t" + path;
      if (!this.pics.has(k)) this.pics.set(k, StickParse.thumb(this.stick, path).then((i) => (i ? this.toURL(i) : null)).catch(() => null));
      return this.pics.get(k);
    },
    // a stand-in for a game with no icon: its initials on a colour from its name,
    // replaced by the real icon (Shelf's picture cache) once that is read
    initials(g) {
      const words = (g.title || g.id || "?").replace(/[:\-–]/g, " ").split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w));
      return words.slice(0, 3).map((w) => [...w][0]).join("").toUpperCase() || "?";
    },
    phStyle(g) { let h = 0; for (const c of g.title || "") h = (h * 31 + c.charCodeAt(0)) % 360; return `background:linear-gradient(160deg,hsl(${h} 45% 40%),hsl(${h} 45% 20%))`; },
    gameIcon(g, extra) { return `<span class="ph" data-icon="${esc(g.key)}" style="${this.phStyle(g)};${extra || ""}">${esc(this.initials(g))}</span>`; },
    async fillIcons(root) {
      const jobs = [];
      for (const el of root.querySelectorAll("[data-icon]")) {
        const g = this.model && this.model.games.get(el.dataset.icon);
        if (!g) continue;
        jobs.push(this.iconURL(g).then((url) => {
          if (!url || !el.isConnected) return;
          const img = new Image(); img.src = url; img.alt = ""; img.style.cssText = el.style.cssText.replace(/background[^;]*;?/g, "");
          el.replaceWith(img);
        }));
      }
      for (const el of root.querySelectorAll("img[data-thumb]")) jobs.push(this.thumbURL(el.dataset.thumb).then((url) => { if (url && el.isConnected) el.src = url; }));
      await Promise.all(jobs);
    },

    async setStick(stick, isSample) {
      const model = await StickParse.build(stick, this.engine);
      this.stick = stick; this.model = model; this.sample = !!isSample; this.pics.clear();
      $("#stickname").textContent = isSample ? "Sample stick" : (stick.label || "Your Memory Stick");
      for (const fn of this.listeners) fn(model);
      return model;
    },
  });

  // ---- tabs and the address bar (#recap, #emblem-workshop) ----------------------------------
  function show(view) {
    for (const t of document.querySelectorAll(".top .tab")) t.setAttribute("aria-selected", String(t.dataset.view === view));
    $("#view-recap").hidden = view !== "recap";
    $("#view-workshop").hidden = view !== "workshop";
    const want = view === "workshop" ? "#emblem-workshop" : "#recap";
    if (location.hash !== want) try { history.replaceState(null, "", want); } catch (e) { /* the frame may refuse */ }
  }
  for (const t of document.querySelectorAll(".top .tab")) t.addEventListener("click", () => show(t.dataset.view));
  const route = () => show(/emblem-(workshop|sets)/.test(location.hash) ? "workshop" : "recap");   // emblem-sets: its first name
  window.addEventListener("hashchange", route);
  App.show = show;

  // ---- loading a stick -------------------------------------------------------------------
  const dlg = $("#loader");
  const NAMES = [["shelf", "Shelf"], ["sidequest", "Sidequest"], ["checkpoint", "Checkpoint"], ["emblem", "Emblem"], ["runtime", "Runtime"]];
  function showFound(model) {
    $("#found").innerHTML = NAMES.map(([k, n]) => `<li class="${model && model.found[k] ? "yes" : ""}">${n}</li>`).join("");
  }
  App.onModel(showFound);
  $("#openStick").addEventListener("click", () => { $("#ldMsg").textContent = ""; dlg.showModal ? dlg.showModal() : dlg.setAttribute("open", ""); });
  $("#ldClose").addEventListener("click", () => dlg.close ? dlg.close() : dlg.removeAttribute("open"));
  async function take(promise, label) {
    const msg = $("#ldMsg");
    msg.className = "small"; msg.textContent = "Reading…";
    try {
      const stick = await promise;
      if (!stick.count) {
        msg.className = "small err";
        msg.textContent = "No SIDEQUEST, CHECKPOINT, EMBLEM, RUNTIME or SHELF folder was found in that. Pick the Memory Stick itself, or the folder that holds those.";
        return;
      }
      if (label) stick.label = label;
      const m = await App.setStick(stick, false);
      const n = [...m.games.values()].length;
      msg.textContent = `Read ${stick.count} files: ${n} game${n === 1 ? "" : "s"}.`;
      App.toast("Your Memory Stick is loaded");
      if (m.notes.length) {         // stay open: something was left out, and the reader should see what
        msg.className = "small err";
        msg.textContent += ` ${m.notes.length} file${m.notes.length === 1 ? " was" : "s were"} skipped because ${m.notes.length === 1 ? "it" : "they"} could not be read: ${m.notes.slice(0, 4).join("; ")}${m.notes.length > 4 ? "; and more" : ""}.`;
      } else setTimeout(() => dlg.close && dlg.close(), 900);
    } catch (e) {
      msg.className = "small err";
      msg.textContent = "That could not be read: " + (e && e.message ? e.message : e);
    }
  }
  $("#pickDir").addEventListener("change", (e) => {
    const files = e.target.files;
    if (!files || !files.length) return;
    const top = (files[0].webkitRelativePath || "").split("/")[0];
    take(Promise.resolve(StickIO.fromFileList(files)), top ? top : "Your Memory Stick");
  });
  $("#pickZip").addEventListener("change", (e) => { const f = e.target.files[0]; if (f) take(StickIO.fromZip(f), f.name); });
  $("#useSample").addEventListener("click", async () => { await loadSample(); $("#ldMsg").className = "small"; $("#ldMsg").textContent = "The sample is back."; });
  const drop = $("#drop");
  for (const el of [drop, document.body]) {
    el.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
    el.addEventListener("dragleave", () => drop.classList.remove("over"));
  }
  document.body.addEventListener("drop", (e) => {
    e.preventDefault(); drop.classList.remove("over");
    if (!e.dataTransfer || !e.dataTransfer.items || !e.dataTransfer.items.length) return;
    if (!dlg.open && dlg.showModal) dlg.showModal();
    const files = [...e.dataTransfer.files];
    const entries = StickIO.dropEntries([...e.dataTransfer.items]);     // now: they are gone once this handler returns
    if (files.length === 1 && /\.zip$/i.test(files[0].name)) take(StickIO.fromZip(files[0]), files[0].name);
    else if (entries.length) take(StickIO.fromDrop(entries), entries.length === 1 ? entries[0].name : "Dropped folders");
    else $("#ldMsg").textContent = "This browser cannot read dropped folders. Use Pick a folder or Pick a zip.";
  });

  // the sample stick is packed into the page as gzip'd JSON (tools/build.py)
  let sampleData = null;
  async function loadSample() {
    if (!sampleData) {
      const bin = atob(window.SAMPLE_STICK_GZ), b = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
      const json = await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
      sampleData = JSON.parse(json);
    }
    return App.setStick(StickIO.fromPacked(sampleData, "Sample stick"), true);
  }
  App.loadSample = loadSample;

  // ---- start ---------------------------------------------------------------------------
  App.start = async function () {
    App.engine = EmblemEngine.load(emblemAsm);
    $("#ver").textContent = window.TOOLS_VERSION || "";
    route();
    if (typeof DecompressionStream === "undefined") throw new Error("this browser is too old for Shelf Tools. It needs Chrome or Edge 80, Firefox 113 or Safari 16.4, or newer");
    await loadSample();
  };
}
