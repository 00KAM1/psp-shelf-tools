#!/usr/bin/env python3
"""Builds index.html: one self-contained page that GitHub Pages serves as it is, and that
also works opened straight from disk. Run from the repository root:

    python3 tools/build.py

It inlines, in this order: the engine (src/emblem-engine.js, made by engine/build.sh),
the page's scripts, the sample stick (tests/sample/ms0, made by tools/make_sample_stick.py)
and Emblem's released game files (games/, copied from psp-ark-plugins by
tools/sync_from_plugins.sh).

    python3 tools/build.py --sample tests/docrun/ms0 --out tests/docrun/index.html

builds a copy from another stick, for the pictures in docs/images only (see
tests/render/doc_pictures.py). Never commit such a copy as index.html.
"""
import argparse, base64, gzip, json, os, re

VERSION = "1.3"
# the sample stick's files are dated as if it was last used then (Runtime's year-less dates count back from it)
SAMPLE_DATE = 1795561200000   # 2026-11-24 23:00 UTC
SCRIPTS = ["emblem-engine.js", "engine.js", "stick.js", "parse.js", "stats.js", "ui.js", "recap.js", "workshop.js"]

ap = argparse.ArgumentParser()
ap.add_argument("--sample", default="tests/sample/ms0", help="the stick the page opens on")
ap.add_argument("--out", default="index.html")
args = ap.parse_args()

def sample_stick():
    root = args.sample
    sizes = {}
    sz = os.path.join(os.path.dirname(root), "sizes.txt")
    if os.path.exists(sz):
        for line in open(sz):
            p, _, v = line.strip().partition(" ")
            if p:
                sizes[p] = int(v)
    out = {}
    for d, _, files in os.walk(root):
        for f in sorted(files):
            full = os.path.join(d, f)
            rel = os.path.relpath(full, root).replace(os.sep, "/")
            data = open(full, "rb").read()
            if rel.startswith("SHELF/CACHE/") and rel.endswith(".IMG"):
                data = data[:8 + 144 * 80 * 2]   # the page reads only the icon; its size stays the real one
            mtime = SAMPLE_DATE   # not the file's: Git does not keep dates, and the build must not change with them
            out[rel] = [sizes.get(rel, len(data)), mtime, base64.b64encode(data).decode()]
    return dict(sorted(out.items()))

def release():
    out = {}
    for f in sorted(os.listdir("games")):
        if f.endswith(".txt"):
            out[f[:-4]] = open(os.path.join("games", f), encoding="utf-8").read()
    return out

def safe(js):  # nothing in an inline script may close it
    return js.replace("</script", "<\\/script")

page = open("src/page.html", encoding="utf-8").read()
parts = []
for s in SCRIPTS:
    parts.append(f"<script>\n/* ---- src/{s} ---- */\n{safe(open(os.path.join('src', s), encoding='utf-8').read())}\n</script>")
data = "window.TOOLS_VERSION = " + json.dumps(VERSION) + ";\n"
packed = gzip.compress(json.dumps(sample_stick(), separators=(",", ":")).encode(), 9, mtime=0)
data += "window.SAMPLE_STICK_GZ = " + json.dumps(base64.b64encode(packed).decode()) + ";\n"
data += "window.EMBLEM_RELEASE = " + json.dumps(release(), ensure_ascii=False, separators=(",", ":")) + ";\n"
parts.append(f"<script>\n/* ---- data: the sample stick and Emblem's released game files ---- */\n{safe(data)}</script>")
parts.append("<script>\n{ App.start().then(() => App.startMaker()).catch((e) => { document.getElementById('recapBody').innerHTML = '<div class=\"band\"><div class=\"wrap card err\">The page could not start: ' + App.esc(e && e.message || e) + '</div></div>'; console.error(e); }); }\n</script>")
out = page.replace("<!--SCRIPTS-->", "\n".join(parts))
open(args.out, "w", encoding="utf-8").write(out)
print(f"{args.out}: {len(out.encode()) // 1024} KB, version {VERSION}")
