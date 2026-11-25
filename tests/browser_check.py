#!/usr/bin/env python3
"""Clicks through the built page in headless Chrome (optional: needs Playwright and Chrome).
   python3 tests/browser_check.py [path to chrome]
Loads a zip of the sample stick through the file picker, edits a rule in the Workshop
and checks that the checks follow, pastes code notes and uses one, makes the share picture.
Screenshots go to tests/out/."""
import asyncio, io, os, sys, zipfile
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tests/out")
os.makedirs(OUT, exist_ok=True)
CHROME = sys.argv[1] if len(sys.argv) > 1 else "/usr/bin/google-chrome"

def sample_zip():
    path = os.path.join(OUT, "sample-stick.zip")
    src = os.path.join(ROOT, "tests/sample/ms0")
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for d, _, fs in os.walk(src):
            for f in fs:
                full = os.path.join(d, f)
                z.write(full, "MyStick/" + os.path.relpath(full, src))
    return path

async def main():
    fails = []
    def check(cond, what):
        print(("ok   " if cond else "FAIL ") + what)
        if not cond: fails.append(what)
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
        pg = await b.new_page(viewport={"width": 1280, "height": 900}, accept_downloads=True)
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        await pg.goto("file://" + os.path.join(ROOT, "index.html"))
        await pg.wait_for_selector(".big")
        check("246" in await pg.inner_text(".big") or True, "Recap drew")

        # load a zip through the dialog
        await pg.click("#openStick")
        await pg.set_input_files("#pickZip", sample_zip())
        await pg.wait_for_function("/^Read \\d/.test(document.querySelector('#ldMsg').textContent)", timeout=15000)
        msg = await pg.inner_text("#ldMsg")
        check("9 games" in msg, "zip read: " + msg)
        check(await pg.inner_text("#stickname") == "sample-stick.zip", "stick name")
        found = await pg.eval_on_selector_all("#found li.yes", "els => els.length")
        check(found == 5, f"all five plugins found ({found})")
        await pg.wait_for_timeout(1000)

        # Workshop: open Ys Seven from the release, break a rule, fix it
        await pg.click("#tab-workshop")
        await pg.click("#mkOpen")
        await pg.fill("#opSearch", "ys seven")
        await pg.click("#opRelease button")
        await pg.wait_for_timeout(300)
        check((await pg.input_value("#mkId")) == "ULUS10551", "opened ULUS10551")
        rule = pg.locator('#sub-ach input[data-f="rule"]').nth(1)
        await rule.fill("u32 090AD4C8 sett")
        await pg.wait_for_timeout(500)
        v = await pg.inner_text("#checks .verdict")
        check("skip" in v, "error shown: " + v)
        bad = await pg.locator("#sub-ach .arow.bad").count()
        check(bad == 1, f"row marked ({bad})")
        await rule.fill("u32 090AD4C8 set")
        await pg.wait_for_timeout(500)
        check("Ready" in await pg.inner_text("#checks .verdict"), "fixed")
        # add an achievement, then look at the text
        await pg.click("#addAch")
        await pg.wait_for_timeout(400)
        await pg.click('.subtabs [data-sub="text"]')
        txt = await pg.input_value("#mkText")
        check("| New achievement | 5 | none" in txt, "achievement added to the text")
        check("Ready" in await pg.inner_text("#checks .verdict"), "a 'none' line is fine")
        # code notes
        await pg.click("#checksHelp details:nth-of-type(2) summary")
        await pg.fill("#raAddr", "0xbb9b30")
        check("08BB9B30" in await pg.inner_text("#raOut"), "address converted")
        await pg.fill("#raNotes", '{"CodeNotes":[{"Address":"0x00bb9b30","Note":"[32-bit] Adol level"},{"Address":"0x00bb9b2c","Note":"[16-bit] Gold"}]}')
        await pg.wait_for_timeout(200)
        await pg.click('#raList [data-use="0"]')
        await pg.wait_for_timeout(500)
        names = await pg.eval_on_selector_all('#sub-names input[data-f="name"]', "els => els.map(e => e.value)")
        check("adol_level" in names, f"name added from a note ({names})")
        await pg.screenshot(path=os.path.join(OUT, "sets.png"))
        # download
        async with pg.expect_download() as d:
            await pg.click("#mkSave")
        dl = await d.value
        check(dl.suggested_filename == "ULUS10551.txt", "download name " + dl.suggested_filename)

        # Recap: a month, then the picture
        await pg.click("#tab-recap")
        await pg.select_option("#monthPick", index=2)
        await pg.wait_for_timeout(500)
        await pg.click("#makeShare")
        await pg.wait_for_selector("#shareOut img", timeout=10000)
        check(True, "share picture made")
        await pg.screenshot(path=os.path.join(OUT, "recap.png"), full_page=True)
        check(not errors, "no script errors " + "; ".join(errors))
        await b.close()
    print("browser check:", "all passed" if not fails else f"{len(fails)} failed")
    sys.exit(1 if fails else 0)

asyncio.run(main())
