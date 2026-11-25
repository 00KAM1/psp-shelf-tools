#!/usr/bin/env python3
"""Takes the pictures in docs/images (headless Chrome through Playwright). Every picture
is the same size, 1280 x 800, the page as it looks on a desktop, so they line up in the
README whatever they show.

With tests/docrun/ms0 there (tools/make_sample_stick.py --art <your art>), the pictures
show your own games' icons and pictures: a copy of the page is built from that stick
into tests/docrun/index.html, which Git ignores, and photographed. Without it, they
show the sample's own drawn scenes. The play itself is the sample's made-up year either way.
   python3 tests/render/doc_pictures.py [path to chrome]"""
import asyncio, os, subprocess, sys
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
IMG = os.path.join(ROOT, "docs/images")
CHROME = sys.argv[1] if len(sys.argv) > 1 else "/usr/bin/google-chrome"
W, H = 1280, 800
os.makedirs(IMG, exist_ok=True)

async def main():
    for f in os.listdir(IMG):           # no picture from an earlier layout is left behind
        if f.endswith(".png"):
            os.remove(os.path.join(IMG, f))
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
        pg = await b.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
        page = os.path.join(ROOT, "index.html")
        if os.path.isdir(os.path.join(ROOT, "tests/docrun/ms0")):
            page = os.path.join(ROOT, "tests/docrun/index.html")
            subprocess.run([sys.executable, "tools/build.py", "--sample", "tests/docrun/ms0", "--out", page], cwd=ROOT, check=True)
        url = "file://" + page

        async def shot(name, top=None):
            """The viewport, scrolled so that `top` (a selector) sits just under the bar."""
            y = 0
            if top:
                y = await pg.evaluate("s => document.querySelector(s).getBoundingClientRect().top + scrollY - 76", top)
            await pg.evaluate("y => scrollTo(0, y)", y)
            await pg.wait_for_timeout(250)
            await pg.screenshot(path=os.path.join(IMG, name))

        await pg.goto(url + "#recap")
        await pg.wait_for_selector(".big"); await pg.wait_for_timeout(1500)
        await shot("recap.png")
        await shot("recap-days.png", ".grid > section:nth-child(3)")
        await shot("recap-records.png", ".grid > section:nth-child(6)")
        await pg.click("#makeShare"); await pg.wait_for_selector("#shareOut img")
        await shot("recap-share.png", ".grid > section:nth-child(10)")
        await pg.select_option("#monthPick", index=1); await pg.wait_for_timeout(800)
        await shot("recap-month.png", ".grid > section:nth-child(3)")

        await pg.click("#tab-workshop"); await pg.wait_for_timeout(600)
        await shot("workshop.png")
        rule = pg.locator('#sub-ach input[data-f="rule"]').nth(2)
        await rule.fill("normal and ellefale sett"); await pg.wait_for_timeout(500)
        await shot("workshop-error.png")
        await rule.fill("normal and ellefale set"); await pg.wait_for_timeout(300)
        await pg.click('.subtabs [data-sub="text"]'); await pg.wait_for_timeout(300)
        await shot("workshop-text.png")
        await b.close()
    print("pictures in docs/images:", ", ".join(sorted(os.listdir(IMG))))
asyncio.run(main())
