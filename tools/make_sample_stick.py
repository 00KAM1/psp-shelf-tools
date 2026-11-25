#!/usr/bin/env python3
"""Builds the sample Memory Stick that the page shows before you load your own, and
that the tests read: tests/sample/ms0. Run from the repository root.

Everything in it is made up: the dates, the hours, the journey lines, which
achievements are earned, the battery. The game titles and IDs are real, and the
Emblem game files are the ones in games/ (copied from psp-ark-plugins), so the
achievement titles and points are real too. The pictures are little scenes drawn
by this script, not game art.

With --art, the same stick is built with the icons and background pictures of your
own games instead (folders holding each game's PARAM.SFO, ICON0.PNG and PIC1.PNG, as
taken from your ISOs), and Shelf's titles read the way Shelf reads them. That stick
is only for the pictures in docs/images (tests/render/doc_pictures.py): it goes to
tests/docrun/ms0, which Git ignores, and is never packed into the page.

    python3 tools/make_sample_stick.py                       # the sample (its own drawn scenes)
    python3 tools/make_sample_stick.py --art ~/shelf-art     # the picture stick

The files are written in exactly the formats the plugins and Shelf write
(see docs/how-it-works.md). Save-state files are only their 4 KB header: the
page never reads further, and a real state would be 5 to 27 MB.
"""
import argparse, os, random, shutil, struct, zlib
from datetime import datetime, timedelta
from PIL import Image, ImageDraw, ImageFont

ap = argparse.ArgumentParser()
ap.add_argument("--art", help="folder of your games' PARAM.SFO / ICON0.PNG / PIC1.PNG folders")
args = ap.parse_args()
ROOT = "tests/docrun/ms0" if args.art else "tests/sample/ms0"
rnd = random.Random(2026)
shutil.rmtree(ROOT, ignore_errors=True)

def path(p):
    full = os.path.join(ROOT, p)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    return full

def write(p, data, mtime=None):
    with open(path(p), "wb" if isinstance(data, bytes) else "w", **({} if isinstance(data, bytes) else {"newline": ""})) as f:
        f.write(data)
    if mtime:
        t = mtime.timestamp()
        os.utime(path(p), (t, t))

def minutes(d):  # minutes since 2000, local time: what Shelf and Runtime store
    return int((d - datetime(2000, 1, 1)).total_seconds() // 60)

WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
def ga_date(d):  # Runtime's "Tue Nov 24 03:30" (no year)
    return f"{WD[d.weekday()]} {MO[d.month - 1]} {d.day} {d.hour:02d}:{d.minute:02d}"
def stamp(d):
    return d.strftime("%Y-%m-%d %H:%M")

# ---- the games -------------------------------------------------------------------
# id, title, file, folder (category), colour, journey places
GAMES = [
    ("ULUS10558", "Ys: The Oath in Felghana", "Ys - The Oath in Felghana (Undub).iso", "JRPG", (196, 64, 48),
     ["Town of Redmont", "Tigray Quarry", "Ilvern Ruins", "Elduke Forest", "Galbalan's Island", "Valestein Castle"]),
    ("ULUS10540", "The Legend of Heroes: Trails in the Sky", "Trails in the Sky.iso", "JRPG", (70, 120, 200),
     ["Rolent", "Bose", "Ruan", "Zeiss", "Grancel", "Grancel Castle"]),
    ("ULUS10482", "Lunar: Silver Star Harmony", "Lunar - Silver Star Harmony.iso", "JRPG", (120, 80, 190),
     ["Burg", "Saith", "Meribia", "Vane", "Reza", "Grindery"]),
    ("ULUS10512", "Shin Megami Tensei: Persona 3 Portable", "Persona 3 Portable (Undub).iso", "JRPG", (60, 150, 210),
     ["Dorm 4/29", "Tartarus 2F", "Dorm 6/8", "Tartarus Thebel", "Dorm 7/7", "Tartarus Arqa"]),
    ("UCUS98700", "Jeanne d'Arc", "Jeanne d'Arc.cso", "Strategy", (170, 140, 70),
     ["Chapter 1", "Chapter 3", "Chapter 5", "Chapter 7", "Chapter 9"]),
    ("ULUS10515", "Valkyria Chronicles 2", "Valkyria Chronicles 2.iso", "Strategy", (80, 130, 90),
     ["Lanseal 1st Term", "Lanseal 2nd Term", "Lanseal 3rd Term"]),
    ("ULUS10551", "Ys Seven", "Ys Seven.iso", "JRPG", (210, 120, 40),
     ["Port of Altago", "Altago City", "Sanctuary of Meditation"]),
    ("ULUS10560", "Final Fantasy IV: The Complete Collection", "Final Fantasy IV Complete.iso", "JRPG", (40, 60, 120),
     ["Baron Castle", "Mist", "Kaipo"]),
]
HOMEBREW = [("LanternHollow", "Lantern Hollow", "Homebrew")]   # made up, like the demo game in Emblem's tools

def read_sfo(b):
    if b[:4] != b"\0PSF":
        return {}
    _, kt, dt, n = struct.unpack_from("<IIII", b, 4)
    out = {}
    for i in range(n):
        ko, fmt, ln, mx, do = struct.unpack_from("<HHIII", b, 20 + 16 * i)
        k = b[kt + ko:b.index(b"\0", kt + ko)].decode()
        v = b[dt + do:dt + do + ln]
        out[k] = struct.unpack("<I", v.ljust(4, b"\0")[:4])[0] if fmt == 0x0404 else v.rstrip(b"\0").decode("utf-8", "replace")
    return out

ART = {}   # disc ID -> (folder, title as Shelf shows it, ICON0, PIC1)
if args.art:
    for folder in sorted(os.listdir(args.art)):
        d = os.path.join(args.art, folder)
        if not os.path.exists(os.path.join(d, "PARAM.SFO")):
            continue
        sfo = read_sfo(open(os.path.join(d, "PARAM.SFO"), "rb").read())
        gid = sfo.get("DISC_ID", "")
        t = sfo.get("TITLE", "")
        # Shelf: the game's own title when it is plain text, else the file name tidied
        if not t or any(ord(c) > 126 or ord(c) < 32 for c in t):
            t = folder.split(" [")[0].split(" (")[0]
        icon = os.path.join(d, "ICON0.PNG")
        pic = os.path.join(d, "PIC1.PNG")
        ART[gid] = (folder, t, icon if os.path.exists(icon) else None, pic if os.path.exists(pic) else None)
    GAMES = [(gid, ART[gid][1] if gid in ART else title, (ART[gid][0] + ".iso") if gid in ART else fn, cat, col, places)
             for gid, title, fn, cat, col, places in GAMES]

def art_picture(gid, w, h, which, crop=0):
    """The game's own ICON0 (fitted, as Shelf does) or PIC1 (filled), or None."""
    a = ART.get(gid)
    path = a and (a[2] if which == "icon" else a[3])
    if not path:
        return None
    img = Image.open(path).convert("RGB")
    if which == "icon":
        img.thumbnail((w, h), Image.LANCZOS)
        out = Image.new("RGB", (w, h))
        out.paste(img, ((w - img.width) // 2, (h - img.height) // 2))
        return out
    if crop:   # a slot picture: a closer part of the background, a different one per slot
        W, H = img.size
        z = 0.72
        cw, ch = int(W * z), int(H * z)
        x = [0, W - cw, (W - cw) // 2][crop % 3]
        y = H - ch          # the lower part: clear of anything written across the top of a background
        img = img.crop((x, y, x + cw, y + ch))
    return img.resize((w, h), Image.LANCZOS)

# ---- the sample's own pictures ------------------------------------------------------------
# Original little scenes, one look per game: a sky, a sun or moon, far hills, one landmark
# and a title. They are drawn here and are nobody's artwork but this repository's: no
# logo, character or cover of any game is copied.
SCENES = {   # disc ID -> sky top, sky bottom, ground, landmark, light ("sun" / "moon"), stars
    "ULUS10558": ((92, 26, 44), (232, 120, 60), (48, 20, 34), "castle", "sun", False),
    "ULUS10540": ((60, 130, 220), (176, 214, 244), (52, 104, 84), "airship", "sun", False),
    "ULUS10482": ((30, 20, 70), (112, 76, 168), (26, 22, 56), "hills", "moon", True),
    "ULUS10512": ((8, 40, 56), (24, 120, 130), (8, 22, 30), "city", "moon", True),
    "UCUS98700": ((150, 110, 50), (236, 204, 130), (86, 62, 30), "banners", "sun", False),
    "ULUS10515": ((90, 160, 200), (206, 232, 214), (70, 120, 64), "windmill", "sun", False),
    "ULUS10551": ((214, 110, 40), (250, 206, 120), (150, 84, 40), "ruins", "sun", False),
    "ULUS10560": ((10, 16, 50), (40, 60, 130), (12, 16, 36), "tower", "moon", True),
    "": ((14, 44, 38), (40, 110, 80), (10, 28, 24), "lantern", "moon", True),
}

def scene(w, h, gid, title, seed):
    """One picture. With a title it is an icon; without, a wider view for a slot or background."""
    top, bottom, ground, landmark, light, stars = SCENES.get(gid, SCENES[""])
    r = random.Random(seed)
    S = 4                                          # drawn four times the size, then scaled down
    W, H = w * S, h * S
    img = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(img)
    mix = lambda a, b, t: tuple(int(a[k] * (1 - t) + b[k] * t) for k in range(3))
    lighter = lambda c, v: tuple(min(255, k + v) for k in c)
    horizon = int(H * (0.52 if title else 0.68))        # an icon's title band takes the bottom
    for y in range(H):
        d.line([(0, y), (W, y)], fill=mix(top, bottom, min(1, y / horizon)))
    if stars:
        for _ in range(60):
            x, y, z = r.randrange(W), r.randrange(int(horizon * 0.8)), r.choice([S // 2, S // 2, S])
            d.rectangle([x, y, x + z, y + z], fill=lighter(bottom, 110))
    lx = int(W * (0.72 if title else r.uniform(0.2, 0.8)))
    ly, lr = int(H * (0.2 if title else 0.26)), int(H * (0.13 if title else 0.15))
    glow = lighter(bottom, 40)
    d.ellipse([lx - lr * 1.5, ly - lr * 1.5, lx + lr * 1.5, ly + lr * 1.5], fill=mix(glow, bottom, 0.5))
    d.ellipse([lx - lr, ly - lr, lx + lr, ly + lr], fill=(255, 240, 200) if light == "sun" else (232, 236, 250))
    if light == "moon":
        d.ellipse([lx - lr * 0.5, ly - lr * 1.1, lx + lr * 1.3, ly + lr * 0.7], fill=mix(top, bottom, ly / horizon))
    for layer, shade in ((0, 0.55), (1, 0.25)):    # two ranges of far hills
        base = horizon - int(H * (0.16 - 0.08 * layer))
        pts, x = [(0, H)], 0
        while x <= W:
            pts.append((x, base - r.randrange(int(H * 0.12))))
            x += r.randrange(W // 9, W // 5)
        pts += [(W, base), (W, H)]
        d.polygon(pts, fill=mix(ground, bottom, shade))
    d.rectangle([0, horizon, W, H], fill=ground)
    dark = tuple(k // 2 for k in ground)
    cx = int(W * (0.3 if title else r.uniform(0.3, 0.7)))
    u = H // (50 if title else 40)                 # the landmark's unit: smaller on an icon, above its title
    box = lambda x0, y0, x1, y1, c=dark: d.rectangle([cx + x0 * u, horizon - y1 * u, cx + x1 * u, horizon - y0 * u], fill=c)
    lit = (255, 214, 120)
    if landmark == "castle":
        box(-9, 0, 9, 8); box(-11, 0, -7, 13); box(7, 0, 11, 13); box(-2, 0, 2, 17)
        for x in (-11, -9, 7, 9, -2, 0): box(x, 13 if abs(x) > 3 else 17, x + 1.2, (13 if abs(x) > 3 else 17) + 1.5)
        box(-0.6, 9, 0.6, 12, lit)
    elif landmark == "airship":
        y = int(H * 0.34)
        d.ellipse([cx - 13 * u, y - 4 * u, cx + 13 * u, y + 4 * u], fill=lighter(ground, 60))
        d.rectangle([cx - 5 * u, y + 4 * u, cx + 5 * u, y + 6.5 * u], fill=dark)
        d.polygon([(cx + 12 * u, y), (cx + 17 * u, y - 4 * u), (cx + 17 * u, y + 4 * u)], fill=dark)
        for k in range(3):
            c = (255, 255, 255)
            x, yy = r.randrange(W), r.randrange(int(H * 0.1), int(H * 0.5))
            d.ellipse([x, yy, x + 14 * u, yy + 4 * u], fill=mix(c, bottom, 0.25))
    elif landmark == "city":
        for k in range(-14, 15, 3):
            hh = r.randrange(5, 15)
            box(k, 0, k + 2.6, hh)
            for wy in range(1, hh - 1, 2):
                if r.random() < 0.6: box(k + 0.5, wy, k + 1.1, wy + 0.8, lit)
        box(-1.2, 0, 1.2, 19); box(-0.6, 15, 0.6, 16.2, lit)
    elif landmark == "banners":
        box(-10, 0, 10, 6); box(-12, 0, -8, 10); box(8, 0, 12, 10)
        for x in (-10, 10):
            d.line([(cx + x * u, horizon - 10 * u), (cx + x * u, horizon - 17 * u)], fill=dark, width=S)
            d.polygon([(cx + x * u, horizon - 17 * u), (cx + (x + 4) * u, horizon - 16 * u), (cx + x * u, horizon - 14 * u)], fill=(170, 40, 40))
    elif landmark == "windmill":
        d.polygon([(cx - 3 * u, horizon), (cx + 3 * u, horizon), (cx + 1.6 * u, horizon - 12 * u), (cx - 1.6 * u, horizon - 12 * u)], fill=dark)
        for a, b in ((-8, -8), (8, -8), (-8, 8), (8, 8)):
            d.line([(cx, horizon - 12 * u), (cx + a * u, horizon - 12 * u + b * u)], fill=dark, width=S * 2)
        box(8, 0, 16, 5); d.polygon([(cx + 7 * u, horizon - 5 * u), (cx + 17 * u, horizon - 5 * u), (cx + 12 * u, horizon - 9 * u)], fill=(150, 60, 50))
    elif landmark == "ruins":
        for x, hh in ((-10, 12), (-5, 8), (2, 14), (8, 6)):
            box(x, 0, x + 2, hh); box(x - 0.5, hh, x + 2.5, hh + 1)
        box(-10, 12, -3, 13.4)
    elif landmark == "tower":
        d.polygon([(cx - 4 * u, horizon), (cx + 4 * u, horizon), (cx + 2 * u, horizon - 20 * u), (cx - 2 * u, horizon - 20 * u)], fill=dark)
        d.polygon([(cx - 3 * u, horizon - 20 * u), (cx + 3 * u, horizon - 20 * u), (cx, horizon - 25 * u)], fill=dark)
        for wy in (5, 10, 15): box(-0.6, wy, 0.6, wy + 1.4, lit)
    elif landmark == "lantern":
        for x in (-12, -4, 6, 13):
            hh = r.randrange(12, 20)
            d.polygon([(cx + (x - 4) * u, horizon), (cx + (x + 4) * u, horizon), (cx + x * u, horizon - hh * u)], fill=dark)
        d.ellipse([cx - 3 * u, horizon - 9 * u, cx + 3 * u, horizon - 3 * u], fill=mix(lit, ground, 0.5))
        d.ellipse([cx - 1.4 * u, horizon - 7.4 * u, cx + 1.4 * u, horizon - 4.6 * u], fill=lit)
    else:                                          # hills: a path over the nearest one
        d.ellipse([cx - 22 * u, horizon - 7 * u, cx + 22 * u, horizon + 10 * u], fill=dark)
        d.polygon([(cx - 1 * u, horizon - 6.6 * u), (cx + 1 * u, horizon - 6.6 * u), (cx + 5 * u, H), (cx - 5 * u, H)], fill=mix(dark, bottom, 0.3))
    if title:
        # the title in a band along the bottom, on one or two lines
        f = ImageFont.truetype(FONT, int(H * 0.15)) if FONT else ImageFont.load_default()
        words = title.split()
        lines_ = [title]
        if d.textlength(title, font=f) > W * 0.92 and len(words) > 1:
            # two lines, split where they come out most even
            k = min(range(1, len(words)), key=lambda n: max(d.textlength(" ".join(words[:n]), font=f), d.textlength(" ".join(words[n:]), font=f)))
            lines_ = [" ".join(words[:k]), " ".join(words[k:])]
        while max(d.textlength(l, font=f) for l in lines_) > W * 0.94 and f.size > 12:
            f = ImageFont.truetype(FONT, f.size - 2)
        lh = int(f.size * 1.18)
        band = lh * len(lines_) + int(H * 0.07)
        shade = Image.new("RGB", (W, band), tuple(k // 3 for k in ground))
        img.paste(Image.blend(img.crop((0, H - band, W, H)), shade, 0.72), (0, H - band))
        d = ImageDraw.Draw(img)
        for k, l in enumerate(lines_):
            d.text(((W - d.textlength(l, font=f)) / 2, H - band + int(H * 0.03) + k * lh), l, font=f, fill=(246, 244, 236))
    return img.resize((w, h), Image.LANCZOS)

FONT = next((f for f in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/data/data/com.termux/files/usr/share/fonts/TTF/DejaVuSans-Bold.ttf") if os.path.exists(f)), None)

def rgb565(img):  # Shelf's and Sidequest's pixel order: red in the low bits
    out = bytearray()
    for r, g, b in (img.get_flattened_data() if hasattr(img, 'get_flattened_data') else img.getdata()):
        out += struct.pack("<H", (r >> 3) | ((g >> 2) << 5) | ((b >> 3) << 11))
    return bytes(out)

# ---- Shelf's library cache (LIBRARY.BIN + one IMG per game) ---------------------------
def crc32(s): return zlib.crc32(s.encode()) & 0xFFFFFFFF
lib = []
for gid, title, fn, cat, col, _ in GAMES:
    p = f"ms0:/ISO/{cat}/{fn}"
    lib.append((p, title, fn.rsplit(".", 1)[0], gid, 0, col))
for folder, title, cat in HOMEBREW:
    lib.append((f"ms0:/PSP/GAME/{cat}/{folder}/EBOOT.PBP", title, folder, "", 2, (40, 140, 60)))
entry = 192 + 96 + 96 + 16 + 4 + 16
blob = struct.pack("<IIII", 0x42494C53, 1, entry, len(lib))
for p, title, ft, gid, typ, col in lib:
    key = crc32(p)
    blob += p.encode().ljust(192, b"\0") + title.encode().ljust(96, b"\0") + ft.encode().ljust(96, b"\0")
    blob += gid.encode().ljust(16, b"\0") + bytes([typ, 1, 1, 1])
    blob += struct.pack("<IIII", 600 * 1024 * 1024, 0, minutes(datetime(2026, 1, 3, 12, 0)), key)
    icon = art_picture(gid, 144, 80, "icon") or scene(144, 80, gid, title, key)
    small = icon.resize((72, 40), Image.BOX)
    back = art_picture(gid, 240, 136, "pic") or scene(240, 136, gid, "", key + 1)
    write(f"SHELF/CACHE/{key:08X}.IMG", struct.pack("<II", 0x31434853, 3) + rgb565(icon) + rgb565(small) + rgb565(back))
write("SHELF/CACHE/LIBRARY.BIN", blob)

# ---- a year of play ------------------------------------------------------------------
# Each game: played in a few runs of evenings between two dates; the hours add up.
PLAN = {
    "ULUS10558": (datetime(2026, 9, 2), datetime(2026, 11, 23), 46, 0.85),
    "ULUS10540": (datetime(2026, 2, 10), datetime(2026, 5, 30), 52, 1.0),
    "ULUS10482": (datetime(2026, 5, 2), datetime(2026, 7, 12), 38, 1.0),
    "ULUS10512": (datetime(2026, 7, 20), datetime(2026, 11, 20), 60, 0.7),
    "UCUS98700": (datetime(2026, 1, 5), datetime(2026, 3, 1), 24, 0.75),
    "ULUS10515": (datetime(2026, 10, 1), datetime(2026, 11, 2), 12, 0.3),
    "ULUS10551": (datetime(2026, 3, 20), datetime(2026, 4, 2), 5, 0.2),
    "ULUS10560": (datetime(2026, 8, 10), datetime(2026, 8, 14), 2, 0.1),
}
COMPLETED = {"ULUS10540": datetime(2026, 5, 30, 22, 40), "ULUS10482": datetime(2026, 7, 12, 21, 5),
             "UCUS98700": datetime(2026, 3, 1, 23, 10)}
FAVOURITES = {"ULUS10558", "ULUS10540", "ULUS10512"}

sessions = []  # (start, end, game id or None for XMB/launcher)
info = {g[0]: g for g in GAMES}
for gid, (a, b, hours, reach) in PLAN.items():
    days = (b - a).days + 1
    left = hours * 60
    n = max(2, int(hours * 60 / 95))
    picks = sorted(rnd.sample(range(days), min(days, n)))
    for k, day in enumerate(picks):
        dur = left // (len(picks) - k) + rnd.randint(-20, 20) if k < len(picks) - 1 else left
        dur = max(20, min(dur, 240))
        left -= dur
        when = a + timedelta(days=day)
        hour = rnd.choice([19, 20, 20, 21, 21, 22, 14, 10]) if when.weekday() < 5 else rnd.choice([10, 11, 14, 15, 16, 20, 21])
        start = when.replace(hour=hour, minute=rnd.randrange(60))
        sessions.append((start, start + timedelta(minutes=dur), gid))
sessions.sort()
# one PSP: a session that would start before the one before has ended moves after it
fixed = []
for start, end, gid in sessions:
    if fixed and start < fixed[-1][1] + timedelta(minutes=40):
        day = fixed[-1][1].date() + timedelta(days=1)
        shift = datetime(day.year, day.month, day.day, start.hour, start.minute) - start
        if start + shift < fixed[-1][1] + timedelta(minutes=40):
            shift += timedelta(days=1)
        start, end = start + shift, end + shift
    fixed.append((start, end, gid))
sessions = fixed
# a few XMB-only and Shelf-only power-ons
for d in (datetime(2026, 4, 12, 9, 30), datetime(2026, 6, 21, 18, 0), datetime(2026, 10, 9, 8, 15)):
    sessions.append((d, d + timedelta(minutes=12), None))
sessions.sort()

# ---- Checkpoint: journey, time played, save versions ---------------------------------------
journey = {}
played = {}
versions = {}
for start, end, gid in sessions:
    if not gid:
        continue
    secs = played.get(gid, 0) + int((end - start).total_seconds())
    played[gid] = secs
    _, _, _, _, _, places = info[gid]
    a, b, hours, reach = PLAN[gid]
    progress = min(1.0, secs / (hours * 3600)) * reach
    place = places[min(len(places) - 1, int(progress * len(places)))]
    t = end - timedelta(minutes=rnd.randrange(2, 9))
    h, m = divmod(int((t - start).total_seconds()) // 60 + (secs - int((end - start).total_seconds())) // 60, 60)
    lst = journey.setdefault(gid, [])
    if not lst or lst[-1][2] != place:
        lst.append((t, f"{h}h {m:02d}m", place, f"{gid}SAVE00"))
    versions.setdefault(gid, []).append(t)
for gid, lst in journey.items():
    title = info[gid][1]
    text = f"# Journey log of {gid}, kept by Checkpoint: date | time played | description | save\r\n"
    text += "".join(f"{stamp(t)} | {tp} | {pl} | {sv}\r\n" for t, tp, pl, sv in lst)
    write(f"CHECKPOINT/JOURNEY/{gid}.TXT", text)
    write(f"CHECKPOINT/JOURNEY/{gid}.TIM", f"{played[gid]}\n")
for gid, ts in versions.items():
    for t in ts[-10:]:  # Checkpoint keeps up to ten
        write(f"CHECKPOINT/{gid}SAVE00/{t.strftime('%Y%m%d_%H%M%S')}/DATA.BIN", b"\0" * 64)
        write(f"CHECKPOINT/{gid}SAVE00/{t.strftime('%Y%m%d_%H%M%S')}/PARAM.SFO", b"\0" * 64)
    write(f"CHECKPOINT/{gid}SAVE00/{ts[-1].strftime('%Y%m%d_%H%M%S')}.PIN", b"")

# ---- Emblem: earned achievements, spread over each game's sessions --------------------------
def ach_lines(gid):
    out = []
    for line in open(f"games/{gid}.txt", encoding="utf-8"):
        s = line.split("#")[0]
        f = [x.strip() for x in s.split("|")]
        if len(f) == 4 and f[0].isdigit() and f[3] and f[3] != "none":
            out.append((int(f[0]), f[1], int(f[2])))
    return out
for gid in PLAN:
    a, b, hours, reach = PLAN[gid]
    lines = ach_lines(gid)
    mine = [s for s in sessions if s[2] == gid]
    k = int(len(lines) * reach * rnd.uniform(0.35, 0.6))
    if not k or not mine:
        continue
    got = sorted(rnd.sample(lines, k), key=lambda x: x[0])
    text = f"# Achievements earned in {info[gid][1]} ({gid}), kept by Emblem\r\n"
    for i, (n, title, pts) in enumerate(got):
        s0, s1, _ = mine[min(len(mine) - 1, int(i / len(got) * len(mine)))]
        t = s0 + (s1 - s0) * rnd.random()
        text += f"{n} | {stamp(t)} | {title} | {pts} pts\r\n"
    write(f"EMBLEM/earned/{gid}.txt", text)
for gid in PLAN:
    shutil.copy(f"games/{gid}.txt", path(f"EMBLEM/games/{gid}.txt"))

# ---- Sidequest: slots for the games still being played --------------------------------------
def sqs(gid, title, boot, when):
    h = bytearray(4096)
    struct.pack_into("<IIII", h, 0, 0x31535153, 5, 4096, 0)
    h[100:100 + len(title.encode())] = title.encode()
    h[228:228 + len(gid)] = gid.encode()
    s = stamp(when).encode(); h[244:244 + len(s)] = s
    h[276:276 + len(boot.encode())] = boot.encode()
    return bytes(h)
SIZES = {}
for gid, slots in {"ULUS10558": [0, 1, 2], "ULUS10512": [0, 1], "ULUS10515": [1]}.items():
    mine = [s for s in sessions if s[2] == gid]
    boot = next(p for p, t, ft, g, typ, col in lib if g == gid)
    for j, k in enumerate(slots):
        s0, s1, _ = mine[-1 - j * 2]
        name = "SUSPEND" if k == 0 else f"STATE{k}"
        write(f"SIDEQUEST/{gid}/{name}.SQS", sqs(gid, info[gid][1], boot, s1 - timedelta(minutes=1)))
        SIZES[f"SIDEQUEST/{gid}/{name}.SQS"] = rnd.randint(9, 24) * 1024 * 1024
        pic = art_picture(gid, 240, 136, "pic", crop=k + 1) or scene(240, 136, gid, "", zlib.crc32(f"{gid}{k}".encode()) & 0xFFFF)
        write(f"SIDEQUEST/{gid}/{name}.THM", b"SQT1" + struct.pack("<HH", 240, 136) + rgb565(pic))
write("SIDEQUEST/config.txt", "# Sidequest settings\r\nresume_prompt = 1\r\n")

# ---- Shelf's own notes ---------------------------------------------------------------------
text = "# Shelf: path | last started | finished | hidden | picture | favourite (times in minutes since 2000)\r\n"
for p, title, ft, gid, typ, col in lib:
    mine = [s for s in sessions if s[2] == gid]
    last = minutes(mine[-1][0]) if mine else (minutes(datetime(2026, 11, 18, 20, 0)) if typ == 2 else 0)
    fin = minutes(COMPLETED[gid]) if gid in COMPLETED else 0
    if last or fin:
        text += f"{p} | {last} | {fin} | 0 | -1 | {1 if gid in FAVOURITES else 0}\r\n"
write("SHELF/games.txt", text)

# ---- Runtime: power-ons and the battery --------------------------------------------------------
ended, use = [], []
pct = 100
for start, end, gid in sessions:
    on0 = start - timedelta(minutes=rnd.randint(2, 6))
    if pct < 35:
        pct = 100
    p0 = pct
    use.append(f"{ga_date(on0)} | {p0:3d}%          | power on XMB")
    use.append(f"{ga_date(on0 + timedelta(minutes=1))} | {p0:3d}%          | start launcher")
    if gid:
        fn = next(ft for p, t, ft, g, typ, col in lib if g == gid)
        iso = next(p for p, t, f2, g, typ, col in lib if g == gid).rsplit("/", 1)[1]
        use.append(f"{ga_date(start)} | {p0:3d}%          | start {iso}")
    mins = int((end - on0).total_seconds() // 60)
    drain = max(1, round(mins / 60 * rnd.uniform(16, 22)))
    pct = max(5, p0 - drain)
    for q in range(p0 - 5, pct, -5):
        t = on0 + timedelta(minutes=int(mins * (p0 - q) / max(1, p0 - pct)))
        use.append(f"{ga_date(t)} | {q:3d}%")
    asleep = rnd.choice([0, 0, 0, 25, 70])
    off = end + timedelta(minutes=3 + asleep)
    span = mins + 3
    line = f"{ga_date(on0)} to {ga_date(off)} | {span // 60}h {span % 60:02d}m"
    if asleep:
        line += f" on, {asleep // 60}h {asleep % 60:02d}m asleep"
    line += f" | battery {p0}% to {pct}% | -{p0 - pct}%"
    ended.append(line)
write("RUNTIME/battery.log", "".join(l + "\r\n" for l in ended), mtime=datetime(2026, 11, 24, 23, 0))
write("RUNTIME/battery_use.log", "".join(l + "\r\n" for l in use), mtime=datetime(2026, 11, 24, 23, 0))
# the power-on in progress: an evening of Ys, not yet in battery.log (Runtime writes that when it ends)
now0, now1 = datetime(2026, 11, 24, 20, 10), datetime(2026, 11, 24, 21, 45)
ys_iso = next(p for p, t, ft, g, typ, col in lib if g == "ULUS10558").rsplit("/", 1)[1]
use.append(f"{ga_date(now0)} | 100%          | power on XMB")
use.append(f"{ga_date(now0 + timedelta(minutes=1))} | 100%          | start launcher")
use.append(f"{ga_date(now0 + timedelta(minutes=3))} | 100%          | start {ys_iso}")
for q, m in ((95, 18), (90, 34), (85, 50), (80, 66), (75, 83)):
    use.append(f"{ga_date(now0 + timedelta(minutes=m))} | {q:3d}%")
write("RUNTIME/battery_use.log", "".join(l + "\r\n" for l in use))
write("RUNTIME/uptime.txt", f"{minutes(now0)} 100 {minutes(now1)} 72 2 0 75\r\n")

with open(os.path.join(os.path.dirname(ROOT), "sizes.txt"), "w") as f:  # the sizes real save states would have
    for k, v in sorted(SIZES.items()):
        f.write(f"{k} {v}\n")
# every file dated as if the stick was last used on 24 Nov 2026, so the page builds the same each time
STAMP = datetime(2026, 11, 24, 23, 0).timestamp()
for d, _, fs in os.walk(ROOT):
    for f in fs:
        os.utime(os.path.join(d, f), (STAMP, STAMP))
print("sample stick:", sum(len(fs) for _, _, fs in os.walk(ROOT)), "files;", len(sessions), "power-ons;",
      sum(played.values()) // 3600, "hours")
