#!/usr/bin/env python3
"""Takes the pictures in docs/images (headless Chrome through Playwright).

With tests/docrun/ms0 there (tools/make_sample_stick.py --art <your art>), the pictures
show your own games' icons and pictures: a copy of the page is built from that stick
into tests/docrun/index.html, which Git ignores, and photographed. Without it, they
show the sample's drawn stand-ins. The play itself is the sample's made-up year either way.
   python3 tests/render/doc_pictures.py [path to chrome]"""
import asyncio, base64, os, subprocess, sys
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
IMG = os.path.join(ROOT, "docs/images")
CHROME = sys.argv[1] if len(sys.argv) > 1 else "/usr/bin/google-chrome"
os.makedirs(IMG, exist_ok=True)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
        pg = await b.new_page(viewport={"width": 1280, "height": 860}, device_scale_factor=1)
        page = os.path.join(ROOT, "index.html")
        if os.path.isdir(os.path.join(ROOT, "tests/docrun/ms0")):
            page = os.path.join(ROOT, "tests/docrun/index.html")
            subprocess.run([sys.executable, "tools/build.py", "--sample", "tests/docrun/ms0", "--out", page], cwd=ROOT, check=True)
        url = "file://" + page
        await pg.goto(url + "#recap")
        await pg.wait_for_selector(".big"); await pg.wait_for_timeout(1500)
        await pg.screenshot(path=os.path.join(IMG, "recap.png"))
        for sel, name in [(".grid > section:nth-child(3)", "recap-days.png"), (".grid > section:nth-child(4)", "recap-achievements.png"), (".grid > section:nth-child(2)", "recap-when.png"), (".grid > section:nth-child(9)", "recap-safety.png"), (".grid > section:nth-child(5)", "recap-journey.png")]:
            await (await pg.query_selector(sel)).screenshot(path=os.path.join(IMG, name))
        await pg.click("#makeShare"); await pg.wait_for_selector("#shareOut img")
        src = await pg.get_attribute("#shareOut img", "src")
        open(os.path.join(IMG, "share.png"), "wb").write(base64.b64decode(src.split(",")[1]))
        await pg.click("#tab-workshop"); await pg.wait_for_timeout(600)
        await pg.evaluate("window.scrollTo(0,0)")
        await pg.screenshot(path=os.path.join(IMG, "workshop.png"))
        rule = pg.locator('#sub-ach input[data-f="rule"]').nth(2)
        await rule.fill("normal and ellefale sett"); await pg.wait_for_timeout(500)
        await pg.evaluate("window.scrollTo(0,0)")
        await pg.screenshot(path=os.path.join(IMG, "workshop-error.png"))
        await rule.fill("normal and ellefale set"); await pg.wait_for_timeout(300)
        phone = await b.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2)
        await phone.goto(url + "#recap"); await phone.wait_for_selector(".big"); await phone.wait_for_timeout(1500)
        await phone.screenshot(path=os.path.join(IMG, "phone.png"))
        await b.close()
    print("pictures in docs/images")
asyncio.run(main())
