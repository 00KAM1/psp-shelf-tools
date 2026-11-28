#!/usr/bin/env python3
"""Clicks through the built page in headless Chrome (optional: needs Playwright and Chrome).
   python3 tests/browser_check.py [path to chrome]
Loads a zip of the sample stick through the file picker, edits a rule in the Workshop
and checks that the checks follow, pastes code notes and uses one, makes the share picture.
Then Checkup on the loaded zip and on the sample. Then Sync: the sample, and a real run through the browser's own folder writing, with the two
folder pickers answered by folders in the browser's private storage (the page is served from
a local address for that, as a page opened from disk has no such storage).
Screenshots go to tests/out/."""
import asyncio, functools, http.server, io, os, sys, threading, zipfile
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
        big = await pg.inner_text(".big")
        check("hours played" in big and big.strip()[0].isdigit(), "Recap drew: " + " ".join(big.split()))

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
        # the page's own warnings: a title Emblem would cut, a game ID with a dash
        await pg.fill("#mkText", txt.replace("| New achievement |", "| " + "A very long title " * 4 + "|").replace("game ULUS10551", "game ULUS-10551"))
        await pg.wait_for_timeout(500)
        v = await pg.inner_text("#checks .verdict")
        warns = await pg.locator("#checksDyn .elist.warn li").count()
        check("2 things" in v and warns == 2, f"warnings shown: {v} ({warns})")
        await pg.fill("#mkText", txt); await pg.wait_for_timeout(500)
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
        # ---- Checkup: the loaded zip (the sample's files, not the sample itself), then the sample ----
        await pg.click("#tab-checkup")
        await pg.wait_for_selector(".ck-card", timeout=20000)
        t = await pg.inner_text("#ckOut")
        check("need fixing" in t and "Will not work" in t and "Extra memory is on" in t, "Checkup reads a loaded Memory Stick: " + t.split("\n")[0])
        check("not a file from a release" in t, "files that are in no release are said to be so")
        check(await pg.is_hidden("#ckSample"), "a loaded Memory Stick is not marked as the sample")
        await pg.click("#openStick"); await pg.click("#useSample")
        await pg.wait_for_function("!document.querySelector('#ckSample').hidden", timeout=15000)
        if await pg.is_visible("#ldClose"): await pg.click("#ldClose")
        await pg.wait_for_function("document.querySelector('#ckOut').innerText.includes('From release 2026-11-25')", timeout=15000)
        t = await pg.inner_text("#ckOut")
        check("2 things need fixing" in t and "Delete these" in t and "Emblem 1.2 is out" in t and "always, ms0:/SEPLUGINS/runtime.prx, on" in t, "the sample's faults are found")
        check("Switched off" in t and "not a file from a release" not in t, "on the sample its stand-ins count as release files")
        rep = await pg.evaluate("App.checkup().text")
        check(rep.startswith("Shelf Tools Checkup 1.") and "[!!] Extra memory is on" in rep, "the report as text")
        await pg.screenshot(path=os.path.join(OUT, "checkup.png"), full_page=True)
        # ---- Library and Backlog: the sample (loaded just above) ---------------------------
        await pg.click("#tab-library")
        await pg.wait_for_selector(".lb-row", timeout=20000)
        await pg.wait_for_function("document.querySelector('#lbOut').innerText.includes('is cut short')", timeout=20000)
        t = await pg.inner_text("#lbOut")
        check("12 of 12" in t and "is on the Memory Stick twice" in t and "Shelf has not scanned 3 games" in t, "the Library lists the sample's games and what is wrong with them")
        check("it should be 1.1 GB and is 322 MB" in t, "the file cut short is found, after the list is up")
        check(await pg.evaluate("document.querySelectorAll('#lbList img').length") >= 11, "icons: Shelf's, and those read from a game Shelf has not scanned")
        await pg.fill("#lbFind", "trails"); await pg.wait_for_timeout(200)
        check("2 of 12" in await pg.inner_text("#lbCount"), "the search box narrows the list")
        await pg.fill("#lbFind", "")
        check(await pg.evaluate("document.querySelectorAll('#lbList button, #lbList input').length") == 0 and "Completed" in await pg.inner_text("#lbList"), "the Library only shows: Shelf's marks are tags, nothing to press")
        await pg.screenshot(path=os.path.join(OUT, "library.png"), full_page=True)
        await pg.click("#tab-backlog")
        await pg.wait_for_selector(".bl-row", timeout=20000)
        t = await pg.inner_text("#blOut")
        check("Next in Trails (Kiseki)" in t and "One story" in t and "Not here" in t, "the Backlog puts the series in order")
        check(await pg.evaluate("document.querySelectorAll('#blOut input, #blOut select').length") == 0, "the Backlog only shows: nothing to type or set")
        await pg.click("#blPick"); await pg.wait_for_timeout(300)
        check(await pg.evaluate("!!document.querySelector('.bl-row.picked')"), "Pick one for me marks a game")
        await pg.screenshot(path=os.path.join(OUT, "backlog.png"), full_page=True)
        # ---- Sync: the sample --------------------------------------------------------------
        await pg.click("#tab-sync")
        await pg.click("#syTry")
        await pg.wait_for_selector(".sy-game", timeout=20000)
        t = await pg.inner_text("#syOut")
        check("for you to choose" in t and "To this device" in t and "To the vault" in t and "Both ways" in t, "sample plan shows every direction")
        check("Take the vault's" in t and "from PS Vita" in t, "the choice names both copies")
        check("Sidequest suspend" in t, "a suspend older than the arriving save is pointed out")
        n0 = await pg.inner_text("#sySync")
        await pg.select_option("#syOut select", "skip")
        check(await pg.inner_text("#sySync") != n0, "leaving a choice for later takes it out of the count: " + n0 + " -> " + await pg.inner_text("#sySync"))
        await pg.select_option("#syOut select", "vault")
        await pg.wait_for_timeout(600)
        await pg.screenshot(path=os.path.join(OUT, "sync-plan.png"), full_page=True)
        await pg.click("#sySync")
        await pg.wait_for_selector(".sy-level", timeout=20000)
        t = await pg.inner_text("#syOut")
        check("PSP-3000 is synced" in t and "Everything is level" in t, "sample synced and level")
        await pg.screenshot(path=os.path.join(OUT, "sync-done.png"), full_page=True)
        check(not errors, "no script errors " + "; ".join(errors))

        # ---- Sync: real folder writing ------------------------------------------------------
        handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
        handler.log_message = lambda *a: None
        srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        pg2 = await b.new_page(viewport={"width": 1280, "height": 900})
        errors2 = []
        pg2.on("pageerror", lambda e: errors2.append(str(e)))
        await pg2.add_init_script("window.showDirectoryPicker = async (o) => window.__pick(o);")
        await pg2.goto(f"http://127.0.0.1:{srv.server_address[1]}/index.html#sync")
        await pg2.wait_for_selector("#syTry")
        await pg2.evaluate("""async () => {
          const root = await navigator.storage.getDirectory();
          for await (const [n] of root.entries()) await root.removeEntry(n, { recursive: true });
          const stick = await root.getDirectoryHandle("PSP_STICK", { create: true }), vault = await root.getDirectoryHandle("Shelf Vault", { create: true });
          const dirOf = async (dir, parts) => { for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: true }); return dir; };
          const put = async (dir, path, data) => { const parts = path.split("/"), d = await dirOf(dir, parts.slice(0, -1)); const w = await (await d.getFileHandle(parts.at(-1), { create: true })).createWritable(); await w.write(data); await w.close(); };
          const get = async (dir, path) => { try { const parts = path.split("/"), d = await dirOf(dir, parts.slice(0, -1)); return await (await (await d.getFileHandle(parts.at(-1))).getFile()).text(); } catch (e) { return null; } };
          const ls = async (dir, path) => { try { const d = await dirOf(dir, path.split("/").filter(Boolean)); const out = []; for await (const [n] of d.entries()) out.push(n); return out.sort(); } catch (e) { return null; } };
          for (const [p, [, , b64]] of Object.entries(await App.sampleFiles())) {
            if (/^(SIDEQUEST|CHECKPOINT\/[^/]+\/\d)/.test(p) || /\.(IMG|PIN)$/.test(p)) continue;
            const bin = atob(b64), b = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
            await put(stick, p, b);
          }
          await put(stick, "PSP/SAVEDATA/ULUS10558SAVE00/PARAM.SFO", SyncCore.sfoWrite({ TITLE: "Ys: The Oath in Felghana", SAVEDATA_TITLE: "Valestein Castle" }));
          await put(stick, "PSP/SAVEDATA/ULUS10558SAVE00/DATA.BIN", "one");
          await put(stick, "PSP/SAVEDATA/ARK_01234/SETTINGS.TXT", "ark");
          window.T = { stick, vault, put, get, ls };
          window.__pick = async (o) => (o.id === "shelf-stick" ? stick : vault);
        }""")
        await pg2.click("#syStick")
        await pg2.wait_for_function("document.querySelector('#syStickName').textContent === 'PSP_STICK'")
        check(await pg2.is_disabled("#sySync"), "nothing to sync with one folder picked")
        await pg2.click("#syVault")
        await pg2.wait_for_selector(".sy-game", timeout=20000)
        t = await pg2.inner_text("#syOut")
        check("Valestein Castle" in t and "Only on this device so far" in t, "a real folder compared: the save is found")
        check(await pg2.input_value("#syDev") == "PSP", "a name is offered for the device")
        await pg2.fill("#syDev", "PSP-3000")
        await pg2.click("#sySync")
        await pg2.wait_for_selector(".sy-level", timeout=30000)
        r = await pg2.evaluate("""async () => ({ save: await T.get(T.vault, "PSP/SAVEDATA/ULUS10558SAVE00/DATA.BIN"), ark: await T.ls(T.vault, "PSP/SAVEDATA"),
          ix: JSON.parse(await T.get(T.vault, "SYNC/VAULT.JSON")), st: JSON.parse(await T.get(T.stick, "SYNC/STATE.JSON")), top: await T.ls(T.vault, ""),
          tim: await T.get(T.vault, "CHECKPOINT/JOURNEY/ULUS10558.TIM"), log: await T.get(T.vault, "SYNC/log.txt") })""")
        check(r["save"] == "one" and r["ark"] == ["ULUS10558SAVE00"], f"the save was written to the vault, ARK's folder was not ({r['ark']})")
        check(r["st"]["vault"] == r["ix"]["id"] and list(r["ix"]["devices"].values())[0]["name"] == "PSP-3000", "device and vault know each other")
        check(r["top"] == ["CHECKPOINT", "EMBLEM", "PSP", "SYNC"] and r["tim"].strip() == "165600", f"the vault's folders ({r['top']})")
        check("PSP-3000: 1 save to the vault" in r["log"], "the log line: " + r["log"].strip())
        check("PSP-3000" in await pg2.inner_text("#syDevices"), "the device is listed with the vault")
        # play: the save changes on the device
        await pg2.evaluate("""() => T.put(T.stick, "PSP/SAVEDATA/ULUS10558SAVE00/DATA.BIN", "two")""")
        await pg2.click("#syCompare")
        await pg2.wait_for_selector(".sy-game", timeout=20000)
        check("Changed on this device" in await pg2.inner_text("#syOut"), "a changed save is seen")
        await pg2.click("#sySync")
        await pg2.wait_for_selector(".sy-level", timeout=30000)
        r = await pg2.evaluate("""async () => ({ save: await T.get(T.vault, "PSP/SAVEDATA/ULUS10558SAVE00/DATA.BIN"), hist: await T.ls(T.vault, "SYNC/history/ULUS10558SAVE00") })""")
        check(r["save"] == "two" and len(r["hist"] or []) == 1, f"the vault has the new save and keeps the old ({r['hist']})")
        # another device brought a newer one to the vault
        await pg2.evaluate("""() => T.put(T.vault, "PSP/SAVEDATA/ULUS10558SAVE00/DATA.BIN", "three")""")
        await pg2.click("#syCompare")
        await pg2.wait_for_selector(".sy-game", timeout=20000)
        check("Newer in the vault" in await pg2.inner_text("#syOut"), "a save newer in the vault is seen")
        await pg2.click("#sySync")
        await pg2.wait_for_selector(".sy-level", timeout=30000)
        r = await pg2.evaluate("""async () => ({ save: await T.get(T.stick, "PSP/SAVEDATA/ULUS10558SAVE00/DATA.BIN"), files: await T.ls(T.stick, "PSP/SAVEDATA/ULUS10558SAVE00"), hist: await T.ls(T.vault, "SYNC/history/ULUS10558SAVE00") })""")
        check(r["save"] == "three" and r["files"] == ["DATA.BIN", "PARAM.SFO"] and len(r["hist"]) == 2, f"written to the device, nothing left behind ({r['files']}, {len(r['hist'])} kept)")
        # the two folders are kept for the next visit (only that they are stored is checked: this
        # headless Chrome stops when a folder of its private storage is read back from the database)
        keys = await pg2.evaluate("""() => new Promise((ok) => { const r = indexedDB.open("shelf-tools", 1); r.onsuccess = () => { const q = r.result.transaction("handles").objectStore("handles").getAllKeys(); q.onsuccess = () => ok(q.result.sort()); }; })""")
        check(keys == ["stick", "vault"], f"both folders are remembered ({keys})")
        check(not errors2, "no script errors in Sync " + "; ".join(errors2))
        srv.shutdown()
        await b.close()
    print("browser check:", "all passed" if not fails else f"{len(fails)} failed")
    sys.exit(1 if fails else 0)

asyncio.run(main())
