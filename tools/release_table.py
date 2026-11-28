#!/usr/bin/env python3
"""Keeps data/official.json, the list of files from the releases that Checkup knows.

For every .prx and Shelf's .PBP in the release zips given, it notes the plugin's name, the
version and build date written inside the file, whether it is the PS Vita build, the file's
size and SHA-256, and the release (the date or v-number in the zip's name). Checkup uses
the list to say which release an installed file is from, and whether a newer one is out.

Entries already in the list are kept, so a new release only needs its own zip:

   python3 tools/release_table.py ~/Downloads/psp-ark-plugins-2026-12-01.zip
   python3 tools/build.py

The zips are the ones attached to the releases of psp-ark-plugins, psp-shelf-launcher,
psvita-ark-plugins and psvita-shelf-launcher. A file is read, never run.
"""
import hashlib, json, os, re, sys, zipfile

OUT = "data/official.json"
NAMES = rb"(Sidequest|Checkpoint|Emblem|Scanline|Runtime|Shelf) (\d+\.\d+)( Vita)?"

def read(data):
    """(name, version, vita, built) written inside a plugin or Shelf, or None."""
    hits = [(m.group(1).decode(), m.group(2).decode(), bool(m.group(3))) for m in re.finditer(NAMES, data)]
    if not hits:
        return None
    count = {}
    for h in hits:
        count[h[0]] = count.get(h[0], 0) + 1
    name = max(count, key=count.get)
    mine = [h for h in hits if h[0] == name]
    pick = next((h for h in mine if h[2]), mine[0])          # a PS Vita build says so; that line is the one
    built = re.search(rb"\(built ([A-Z][a-z]{2} [ \d]\d \d{4} \d\d:\d\d:\d\d)\)", data)
    return pick[0], pick[1], pick[2], built.group(1).decode() if built else ""

def main(zips):
    table = json.load(open(OUT))["files"] if os.path.exists(OUT) else []
    seen = {e["sha256"] for e in table}
    for zp in zips:
        tag = re.search(r"(\d{4}-\d{2}-\d{2}[a-z]?|v\d+(?:\.\d+)*)\.zip$", os.path.basename(zp))
        if not tag:
            sys.exit(f"{zp}: no release date or version in the name")
        z = zipfile.ZipFile(zp)
        for i in z.infolist():
            if not re.search(r"\.(prx|pbp)$", i.filename, re.I):
                continue
            data = z.read(i)
            got = read(data)
            sha = hashlib.sha256(data).hexdigest()
            if not got:
                print(f"  {i.filename}: no version inside, left out")
                continue
            if sha in seen:
                continue
            seen.add(sha)
            name, version, vita, built = got
            table.append({"name": name.lower(), "platform": "vita" if vita else "psp", "version": version, "built": built,
                          "sha256": sha, "size": len(data), "release": tag.group(1)})
            print(f"  {name} {version}{' Vita' if vita else ''}, {tag.group(1)}")
    table.sort(key=lambda e: (e["platform"], e["name"], e["release"], e["version"]))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump({"files": table}, open(OUT, "w"), indent=1)
    open(OUT, "a").write("\n")
    print(f"{OUT}: {len(table)} files")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1:])
