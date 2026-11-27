# Shelf Tools 1.4: known issues and limits

Tried in Chrome on a computer and at phone size, with the sample Memory Stick. **It has also been tested on one real Memory Stick and on one PS Vita `pspemu` folder (Adrenaline 8 with ARK-5), battery figures included.** The formats it reads are taken from the plugins' and Shelf's source, and the tests build files in exactly those formats. **Sync, new in 1.4, has not yet been run on a real Memory Stick or PS Vita**; see [Sync](#sync).

## Disclosure

Shelf Tools was written by Claude, Anthropic’s AI model, from my ideas and my testing with files from my PSP-3000. I’m not a web developer, and nothing has been tested beyond my own setup.

- No one else has reviewed the code.
- Recap and the Emblem Workshop only read. A file they cannot read is skipped, and the Load window says which.
- Sync writes to the Memory Stick and to the vault folder, and only when you press Sync now. It removes no save from either: a save it replaces is copied to the vault's history first.
- Nothing leaves the browser: there is no server behind the page, and GitHub only serves the page itself.

## Recap

- **Runtime's dates have no year.** `battery.log` and `battery_use.log` say "Tue Nov 24 03:30". Recap works the year out from the weekday, reading back from the date the file was last changed. A clock set to the wrong date on the PSP gives wrong years.
- **Time played is the larger of two counts**, Checkpoint's and Runtime's (see [how it works](how-it-works.md#time-played)). Checkpoint counts PSP games only, so PS1 games and homebrew have hours only with Runtime.
- **Checkpoint's time in a period** comes from the running total in its journey lines. Play after a game's last journey line counts in the period of that game's last activity.
- **The busiest day and the calendar** for a game Runtime has not seen put the play between two journey lines on the day of the second.
- **Long file names.** Runtime logs at most 47 characters of a game's file name. A longer name is matched to the game whose file name begins with it. If two games begin with the same 47 characters, the one with a save, journey entry or achievement nearest that time gets the session, which can be the wrong one.
- **A game with no icon** is one Shelf's picture cache has no icon for: a game Runtime saw that is no longer on the Memory Stick, a game whose file has no icon of its own, or a Memory Stick without Shelf. It shows its initials.
- **The safety net** shows the Sidequest slots on the Memory Stick now, whatever period is picked.
- **The session in progress** is counted up to Runtime's last look at the clock, which it takes every two minutes.
- **Battery per hour** uses power-ons of 20 minutes or more that ended lower than they started.
- **The share picture** cannot be downloaded from inside some viewers (an embedded preview, for example). Press and hold it, or right-click it, to save it.

## Emblem Workshop

- **The engine is Emblem 1.2's.** A newer Emblem may read files differently until this page is rebuilt with `tools/sync_from_plugins.sh`.
- **Comments.** The row views keep a comment that follows a rule, written back as `   # comment`, and leave comment lines alone. Other spacing in an edited line is tidied.
- **Memory dumps** are run as given: 24 MB from `0x08800000`, or 32 MB or more from `0x08000000`. A dump taken while the game was loading or on its title screen shows nothing useful.
- **Your work is kept** in the browser's storage for this page. Clearing the site's data loses an undownloaded file.

## Sync

- **Not yet run on a real Memory Stick or PS Vita.** The PC tests take a PSP, a PS Vita and a vault, as real folders, through first syncs, play on each device, a save changed on both, a removed save and syncs cut short. The browser check runs the same code through Chrome's own folder writing. A USB drive on a real computer is the step still to come. **Before your first sync, copy `PSP/SAVEDATA` from each device to your computer**, somewhere other than the vault.
- **Chromium browsers only**: Chrome, Edge and the like, on a computer. Brave keeps folder writing switched off until **File System Access API** is turned on under `brave://flags`. Firefox and Safari cannot write to a folder from a page. Chrome on Android can, but Sync has not been tried on a phone, and Android does not swap a written file in as one step the way a computer does. The sample works everywhere.
- **The browser may refuse a folder.** Chrome will not open some folders, such as your home folder itself or system folders. Keep the vault in a folder of its own inside Documents. If it will not open the Memory Stick's drive, Sync cannot be used on it.
- **Sidequest's states and suspends are not synced.** A state only loads on the device that made it. After a newer save arrives for a game, a state or suspend of that game on the device still loads the older moment, and saving from there overwrites the newer save. The plan warns about each one.
- **Which saves are taken.** Folders in `PSP/SAVEDATA` whose name starts with a disc ID (four letters and five digits), up to 32 MB. ARK's folder and anything else are left alone, and the plan lists what was too large under "Left alone".
- **A save both devices changed** is yours to choose. The dates shown are the ones each device's clock wrote, so a wrong clock gives a wrong date. The one you do not take goes to the vault's history.
- **The history is short.** `SYNC/history` in the vault keeps the last 5 replaced copies of each save. Putting one back is done by hand: copy its files into `PSP/SAVEDATA/<save>/` on the Memory Stick.
- **A save that arrives is not one of Checkpoint's versions** until the game next saves on that device. The save it replaced is in the vault's history, not in Checkpoint's list.
- **File dates.** A browser cannot set a file's date, so files Sync writes carry the time of the sync. Where the PSP shows a save's date from its files, it shows that time.
- **Time played is added up from each device's own count** since its last sync. The count of where each device stood is in the vault's `SYNC/VAULT.JSON`. If the vault is lost, or a Memory Stick's `SYNC` folder is deleted, the next sync is a first sync again: journey lines both sides share are counted once, but a game with time and no journey lines on both sides has its two times added.
- **Journey totals are rewritten when lines are joined.** A line's "time played" is the total at that moment on the device that wrote it. When lines from two devices are put in date order, the totals are recalculated so that they run on across both.
- **Shelf's marks need Shelf's library** on the device (it ties a game's file to its disc ID), so a device that has not run Shelf gets none, and homebrew, which has no disc ID, is not matched. Which picture a game shows on Home stays each device's own.
- **Runtime's logs are only kept in the vault**, under `SYNC/devices`. Recap still shows one Memory Stick at a time.
- **A sync that is cut short** (the cable pulled, the page closed) loses nothing, but leaves work for the next one. A save that was being written to the device is marked first, and the next Compare offers the vault's whole copy of it. Play time the vault had already taken in is not added a second time.
- **One page at a time.** Syncing the same vault from two browser windows at once is not guarded against.
- **The two folders are remembered** in the browser's storage for this page. Clearing the site's data forgets them, nothing more.

## Loading

- **Dropped folders** need a browser that hands dropped folders to a page, as current Chrome, Edge, Firefox and Safari do. The reading is covered by the PC tests; a real drop in each browser is not. If a drop does nothing, use Pick a folder or Pick a zip.

- **PS Vita:** the Memory Stick is the `pspemu` folder (`ux0:pspemu`, or the **Memory Stick Location** set in Adrenaline's menu). Pick that folder, not the card's root. If the computer asks to format the card when you connect, the wrong **USB device** is chosen in Adrenaline's menu; do not format. Only Adrenaline 8 with ARK-5 has been tried, as that is what the Vita builds are made for. See [On a PS Vita](../README.md#on-a-ps-vita-adrenaline-8).
- **Phones** often cannot pick a folder; use a zip. iPhone and iPad: Files app, select the five folders, Compress.
- **Zips:** stored and deflated entries, zip64 included. Other compression methods are refused with a message.
- **The fonts** load from Google Fonts. Offline, the page uses your system's fonts.

## When something is wrong

The page keeps no log. A line it cannot make sense of is skipped and the rest of the file still counts. A file that cannot be read at all is skipped and named under the Load buttons. The browser's console (F12) shows any script error.
