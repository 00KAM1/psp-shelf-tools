#!/usr/bin/env python3
"""Adds the games themselves to the sample Memory Stick, for the Library and the Backlog.

Shelf's library on the sample lists nine games but the sample held no game files. This
writes one for each: a real ISO 9660 image (one of them as a CSO), a few sectors long, with
PSP_GAME/PARAM.SFO and the icon Shelf's cache holds for it, and the homebrew's EBOOT.PBP.
tests/sample/sizes.txt gives the sizes real ones would have.

It also adds what a Library should notice:
  - Ys Seven a second time, under another file name (the same disc ID twice)
  - a game Shelf has not scanned yet, as a ZSO: Trails in the Sky SC
  - a game whose copy was cut short: the image says it is larger than the file is
  - an update folder in PSP/GAME, which is not a game

   python3 tools/make_sample_library.py     (from the repository's root; then tools/build.py)
"""
import io, os, struct, zlib
from PIL import Image, ImageDraw

ROOT = "tests/sample/ms0"
SECTOR = 2048
MB = 1024 * 1024

def both32(v): return struct.pack("<I", v) + struct.pack(">I", v)
def both16(v): return struct.pack("<H", v) + struct.pack(">H", v)

def record(name, lba, size, is_dir):
    n = name if isinstance(name, bytes) else name.encode()
    r = bytes([0, 0]) + both32(lba) + both32(size) + bytes([126, 11, 24, 0, 0, 0, 0]) + bytes([2 if is_dir else 0, 0, 0]) + both16(1) + bytes([len(n)]) + n
    if len(r) % 2: r += b"\0"
    return bytes([len(r)]) + r[1:]

def iso(files, claim_sectors=None):
    """A disc image holding PSP_GAME/<name> for each file."""
    lba, placed = 20, []
    for name, data in files:
        placed.append((name, lba, data)); lba += max(1, -(-len(data) // SECTOR))
    total = lba
    root = record(b"\0", 18, SECTOR, True) + record(b"\1", 18, SECTOR, True) + record("PSP_GAME", 19, SECTOR, True)
    game = record(b"\0", 19, SECTOR, True) + record(b"\1", 18, SECTOR, True) + b"".join(record(n + ";1", l, len(d), False) for n, l, d in placed)
    pvd = bytearray(SECTOR)
    pvd[0] = 1; pvd[1:6] = b"CD001"; pvd[6] = 1
    pvd[8:40] = b"PSP GAME".ljust(32); pvd[40:72] = b"SAMPLE".ljust(32)
    pvd[80:88] = both32(claim_sectors or total); pvd[120:124] = both16(1); pvd[124:128] = both16(1); pvd[128:132] = both16(SECTOR)
    pvd[156:190] = record(b"\0", 18, SECTOR, True)
    end = bytearray(SECTOR); end[0] = 255; end[1:6] = b"CD001"; end[6] = 1
    out = bytearray(total * SECTOR)
    out[16 * SECTOR:17 * SECTOR] = pvd; out[17 * SECTOR:18 * SECTOR] = end
    out[18 * SECTOR:18 * SECTOR + len(root)] = root; out[19 * SECTOR:19 * SECTOR + len(game)] = game
    for _, l, d in placed: out[l * SECTOR:l * SECTOR + len(d)] = d
    return bytes(out)

def cso(image):
    """CSO v1: raw deflate a block, or the block as it is when that is no smaller."""
    n = len(image) // SECTOR
    blocks, index, pos = [], [], 24 + (n + 1) * 4
    for i in range(n):
        raw = image[i * SECTOR:(i + 1) * SECTOR]
        c = zlib.compressobj(9, zlib.DEFLATED, -15); d = c.compress(raw) + c.flush()
        plain = len(d) >= SECTOR
        index.append(pos | (0x80000000 if plain else 0)); blocks.append(raw if plain else d); pos += len(blocks[-1])
    index.append(pos)
    return b"CISO" + struct.pack("<IQIBB2x", 24, len(image), SECTOR, 1, 0) + b"".join(struct.pack("<I", x) for x in index) + b"".join(blocks)

def lz4_literals(raw):
    """A block as one LZ4 run of literals: real LZ4, with nothing to match."""
    n = len(raw) - 15; ext = b"\xff" * (n // 255) + bytes([n % 255])
    return b"\xf0" + ext + raw

def zso(image):
    n = len(image) // SECTOR
    blocks, index, pos = [], [], 24 + (n + 1) * 4
    for i in range(n):
        raw = image[i * SECTOR:(i + 1) * SECTOR]
        empty = not any(raw)
        b = lz4_literals(raw) if not empty else raw          # empty sectors are stored, the rest go through LZ4
        index.append(pos | (0x80000000 if empty else 0)); blocks.append(b); pos += len(b)
    index.append(pos)
    return b"ZISO" + struct.pack("<IQIBB2x", 24, len(image), SECTOR, 1, 0) + b"".join(struct.pack("<I", x) for x in index) + b"".join(blocks)

def sfo(fields):
    keys = sorted(fields); kb = [k.encode() + b"\0" for k in keys]; vb = []
    for k in keys:
        v = fields[k].encode() + b"\0"; vb.append((len(v), v + b"\0" * (-len(v) % 4)))
    keys_at = 20 + 16 * len(keys); data_at = (keys_at + sum(map(len, kb)) + 3) & ~3
    out = bytearray(data_at + sum(len(v[1]) for v in vb))
    out[0:20] = struct.pack("<4sIIII", b"\0PSF", 0x0101, keys_at, data_at, len(keys))
    ko = vo = 0
    for i, k in enumerate(keys):
        out[20 + i * 16:36 + i * 16] = struct.pack("<HHIII", ko, 0x0204, vb[i][0], len(vb[i][1]), vo)
        out[keys_at + ko:keys_at + ko + len(kb[i])] = kb[i]; out[data_at + vo:data_at + vo + len(vb[i][1])] = vb[i][1]
        ko += len(kb[i]); vo += len(vb[i][1])
    return bytes(out)

def png(im):
    b = io.BytesIO(); im.save(b, "PNG", optimize=True); return b.getvalue()

def cached_icon(key):
    """Shelf's 144x80 icon of a game, from its cache, as the PNG the game would hold."""
    raw = open(os.path.join(ROOT, f"SHELF/CACHE/{key:08X}.IMG"), "rb").read()[8:8 + 144 * 80 * 2]
    im = Image.new("RGB", (144, 80)); px = im.load()
    for i in range(144 * 80):
        v = raw[i * 2] | raw[i * 2 + 1] << 8
        px[i % 144, i // 144] = ((v & 31) * 255 // 31, ((v >> 5) & 63) * 255 // 63, ((v >> 11) & 31) * 255 // 31)
    return png(im)

def drawn_icon(lines, colour):
    im = Image.new("RGB", (144, 80), colour); d = ImageDraw.Draw(im)
    for y in range(80): d.line([(0, y), (144, y)], fill=tuple(max(0, c - y) for c in colour))
    for i, l in enumerate(lines): d.text((8, 44 + i * 13), l, fill=(255, 255, 255))
    return png(im)

def w(rel, data):
    p = os.path.join(ROOT, rel); os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, "wb").write(data)

def game_files(title, disc, icon):
    return [("PARAM.SFO", sfo({"CATEGORY": "UG", "DISC_ID": disc, "TITLE": title})), ("ICON0.PNG", icon)]

# ---- the games Shelf's library lists ---------------------------------------------------------
lib = open(os.path.join(ROOT, "SHELF/CACHE/LIBRARY.BIN"), "rb").read()
entry, count = struct.unpack_from("<II", lib, 8)
txt = lambda at, n: lib[at:at + n].split(b"\0")[0].decode("utf-8")
SIZES = {"ULUS10558": 482, "ULUS10540": 611, "ULUS10482": 704, "ULUS10512": 1638, "UCUS98700": 517, "ULUS10515": 1489, "ULUS10551": 1127, "ULUS10560": 1402}
sizes = {}
for i in range(count):
    at = 16 + i * entry
    path, title, disc, kind = txt(at, 192), txt(at + 192, 96), txt(at + 384, 16), lib[at + 400]
    rel = path[len("ms0:/"):]
    icon = cached_icon(struct.unpack_from("<I", lib, at + 416)[0]) if lib[at + 401] else None
    if kind == 2:       # the homebrew: an EBOOT.PBP with its PARAM.SFO and icon
        s = sfo({"CATEGORY": "MG", "TITLE": title}); ic = icon or b""
        off = [40, 40 + len(s), 40 + len(s) + len(ic)] + [40 + len(s) + len(ic)] * 5
        w(rel, struct.pack("<4sI8I", b"\0PBP", 0x10000, *off) + s + ic + b"\x7fELF" + bytes(60))
        sizes[rel] = 3 * MB
        continue
    image = iso(game_files(title, disc, icon or drawn_icon([title[:18]], (60, 90, 140))))
    w(rel, cso(image) if rel.lower().endswith(".cso") else image)
    sizes[rel] = SIZES.get(disc, 800) * MB

# ---- and what a Library should notice --------------------------------------------------------
ys7 = next(txt(16 + i * entry, 192) for i in range(count) if txt(16 + i * entry + 384, 16) == "ULUS10551")
w("ISO/JRPG/Ys Seven (USA).iso", open(os.path.join(ROOT, ys7[len("ms0:/"):]), "rb").read())
sizes["ISO/JRPG/Ys Seven (USA).iso"] = 1127 * MB
w("ISO/JRPG/Trails in the Sky SC.zso", zso(iso(game_files("The Legend of Heroes: Trails in the Sky SC", "ULUS10578", drawn_icon(["Trails in the Sky", "SC"], (150, 110, 40))))))
sizes["ISO/JRPG/Trails in the Sky SC.zso"] = 934 * MB
w("ISO/Strategy/Tactics Ogre - Let Us Cling Together.iso",
  iso(game_files("Tactics Ogre: Let Us Cling Together", "ULUS10565", drawn_icon(["Tactics Ogre"], (110, 50, 60))), claim_sectors=1090 * MB // SECTOR))
sizes["ISO/Strategy/Tactics Ogre - Let Us Cling Together.iso"] = 322 * MB
s = sfo({"CATEGORY": "PG", "DISC_ID": "NPJH50332", "TITLE": "Update"})
w("PSP/GAME/NPJH50332/EBOOT.PBP", struct.pack("<4sI8I", b"\0PBP", 0x10000, 40, 40 + len(s), *([40 + len(s)] * 6)) + s)

# sizes.txt: keep what is there, set these
sz = os.path.join(os.path.dirname(ROOT), "sizes.txt")
have = {}
for line in open(sz):
    p, _, v = line.strip().rpartition(" ")
    if p: have[p] = int(v)
have.update(sizes)
open(sz, "w").write("".join(f"{p} {v}\n" for p, v in sorted(have.items())))
print(f"sample library written: {len(sizes)} game files")
