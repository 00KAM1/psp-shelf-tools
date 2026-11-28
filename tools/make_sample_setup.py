#!/usr/bin/env python3
"""Adds an installed setup to the sample Memory Stick, for Checkup: the plugins in
SEPLUGINS, ARK's two settings files, Shelf and its launcher copy, and the plugins' logs.

The .prx and .PBP files are stand-ins, not programs: a file header, a line saying so, and
the version and build lines Checkup looks for. tests/sample/official.json lists their
fingerprints, so that Checkup can treat them, on the sample only, as files from a release.

The setup has things for Checkup to find:
  - Extra memory is on, which Sidequest cannot run with
  - Runtime's line says "game" where it needs "always"
  - Emblem is one release behind
  - Scanline is switched off
  - the Sidequest states are older than the Sidequest that is installed
  - a plugin that is not one of these is listed too

   python3 tools/make_sample_setup.py     (from the repository's root; then tools/build.py)
"""
import hashlib, json, os, struct

ROOT = "tests/sample/ms0"

def w(rel, data):
    p = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "wb") as f:
        f.write(data if isinstance(data, bytes) else data.encode())
    return data if isinstance(data, bytes) else data.encode()

def prx(name, version, built, extra=""):
    body = b"\x7fELF" + bytes(60)
    body += b"Shelf Tools sample: a stand-in for " + name.lower().encode() + b".prx, not a plugin\0"
    body += f"{name} {version}\0".encode() + f"{name} {version} (built {built}) start{extra}\0".encode()
    return body + bytes(-len(body) % 16)

def pbp(version, built):
    body = b"\0PBP" + struct.pack("<I8I", 0x10000, *([40] * 8))
    body += b"Shelf Tools sample: a stand-in for Shelf, not a program\0"
    body += f"Shelf {version}\0".encode() + f"Shelf {version} (built {built}) from %s, ARK\0".encode()
    return body + bytes(-len(body) % 16)

# name, version on the sample, its build, the release it stands for
PLUGINS = [("Sidequest", "1.3", "Nov 24 2026 13:28:58", "2026-11-25"),
           ("Checkpoint", "1.2", "Nov 24 2026 13:29:00", "2026-11-25"),
           ("Emblem", "1.0", "Nov 22 2026 03:34:23", "2026-11-23"),
           ("Scanline", "1.2", "Nov 24 2026 13:29:05", "2026-11-25"),
           ("Runtime", "1.0", "Nov 24 2026 08:13:05", "2026-11-25")]
SHELF = ("Shelf", "1.2", "Nov 26 2026 09:00:17", "2026-11-26")

table = []
def note(name, version, built, release, data):
    table.append({"name": name.lower(), "platform": "psp", "version": version, "built": built,
                  "sha256": hashlib.sha256(data).hexdigest(), "size": len(data), "release": release, "sample": True})

for name, version, built, release in PLUGINS:
    note(name, version, built, release, w(f"SEPLUGINS/{name.lower()}.prx", prx(name, version, built)))
shelf = pbp(SHELF[1], SHELF[2])
w("PSP/GAME/SHELF/EBOOT.PBP", shelf)
note(*SHELF, w("PSP/SAVEDATA/ARK_01234/VBOOT.PBP", shelf))

w("SEPLUGINS/PLUGINS.TXT", "\r\n".join([
    "game, ms0:/SEPLUGINS/sidequest.prx, on",
    "game, ms0:/SEPLUGINS/checkpoint.prx, on",
    "game, ms0:/SEPLUGINS/scanline.prx, off",
    "game, ms0:/SEPLUGINS/emblem.prx, on",
    "game, ms0:/SEPLUGINS/runtime.prx, on",
    "game, ms0:/SEPLUGINS/pocketclock.prx, on",
]) + "\r\n")
w("PSP/SAVEDATA/ARK_01234/SETTINGS.TXT", "\r\n".join([
    "always, usbcharge, on",
    "always, highmem, on",
    "always, mscache, on",
    "always, skiplogos, on",
    "always, launcher, on",
    "ULUS10512, highmem, off",
]) + "\r\n")

# each plugin's log opens a run with its name, version and build
w("SIDEQUEST/sidequest.log", "Sidequest 1.3 (built Nov 24 2026 13:28:58) start: model=8 keyconfig=000\r\nconfig: hotkey=0001 hold=1000 load=1\r\n")
w("CHECKPOINT/checkpoint.log", "Checkpoint 1.2 (built Nov 24 2026 13:29:00) start: hooks ok, keep 10, min 5 min\r\nmemory free: 1280 KB\r\n")
w("EMBLEM/emblem.log", "Emblem 1.0 (built Nov 22 2026 03:34:23) start: game 'ULUS10558', hook syscall\r\n")
w("SCANLINE/scanline.log", "Scanline 1.0 (built Nov 22 2026 02:55:46) start: model=8\r\n")
w("RUNTIME/runtime.log", "Runtime 1.0 (built Nov 24 2026 08:13:05) in ms0:/ISO/PSP/Ys The Oath in Felghana (USA) [Undub].iso, battery reading found, same power-on\r\n")
w("SCANLINE/config.txt", "# Scanline\r\nhotkeys = 1\r\n")

json.dump({"files": table}, open("tests/sample/official.json", "w"), indent=1)
print(f"sample setup written: {len(table)} stand-ins, tests/sample/official.json")
