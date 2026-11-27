# Changelog

## 1.4

Nothing to install: the site updates itself. If you keep a copy for offline use, replace its `index.html`.

- **Sync, a third tool.** It keeps game saves, Emblem's achievements and game files, Checkpoint's journey and time played, and Shelf's favourites and completed marks level between your PSPs and PS Vitas. Each device is synced with a vault, a folder on your computer; the page shows what would move before anything is written. A save changed on two devices is yours to choose, nothing is deleted, and a save that is replaced is kept in the vault. Sidequest's states are left alone.
- Sync needs Chrome, Edge or another Chromium browser on a computer (in Brave, with File System Access API switched on under `brave://flags`). **It has not yet been run on a real Memory Stick or PS Vita**: copy `PSP/SAVEDATA` from each device to your computer before your first sync. **Try it on the sample** shows how it works without touching anything.
- Since the release (2026-11-27, documentation only): Sync has been run in Chrome and Chromium and works there, and Recap and the Emblem Workshop have been tried in Firefox as well. The "Tested on" lines say so.
- Recap and the Emblem Workshop are unchanged.

## 1.3

Nothing to install: the site updates itself. If you keep a copy for offline use, replace its `index.html`.

- **The page says how to load a PS Vita.** "Load your Memory Stick" now explains that on a PS Vita (ARK-5 inside Adrenaline 8) the Memory Stick is the `pspemu` folder on the card, and that this folder is the one to pick. The message shown when no plugin folder is found says the same. Nothing in the reading changed: a Vita's `pspemu` folder already worked.
- The documentation has a section on using Shelf Tools with a PS Vita, and "Tested on" now includes one PS Vita `pspemu` folder.

## 1.2

Nothing to install: the site updates itself. If you keep a copy for offline use, replace its `index.html`.

- **A game with a long file name no longer appears twice.** Runtime has room for 47 characters of a game's file name in its log, so a longer name arrives cut short. The page took a cut name for a game it did not know and listed it a second time, with no icon and with part of the game's hours. A cut name now finds the game whose file name begins with it. When several games begin the same way, such as the discs of one game, the one with a save, journey entry or achievement nearest that time is taken.
- The documentation says what has been tested: the sample Memory Stick and one real Memory Stick.

## 1.1

Nothing to install: the site updates itself. If you keep a copy for offline use, replace its `index.html`.

- **Dropping the five plugin folders onto the page now reads all of them.** Before, only the first folder dropped was read.
- **The play session in progress is counted.** Runtime only logs a power-on when it ends, so the newest session of play was left out. Recap now takes it from Runtime's `uptime.txt`.
- **A file that cannot be read is skipped**, and the page says which, instead of the whole load stopping.
- **Recap is laid out for a desktop screen**: the rows of cards end together. When you play adds the number of sessions with their average and longest, a month shows its weeks, and the picture to share has its own preview.
- **The Workshop points out what Emblem accepts without a word**: a title Emblem would cut at 47 characters, an achievement with no title, a game ID with a dash, a second `game` line. A file with no achievements is no longer called ready.
- The wording across the page and the documentation was gone over. The picture to share no longer says "PSP-3000".
- **The sample has pictures of its own**: a small drawn scene and the title for each game, in place of the plain tiles with initials.
- The page has an icon and a description for links to it.
- The pictures in this repository are all one size, 1280 × 800.

## 1.0

Initial release: Recap and the Emblem Workshop, on one page. Reads Sidequest, Checkpoint, Emblem, Runtime and Shelf files from a picked folder, dropped folders or a zip. The Workshop's engine is Emblem's `em.c` from psp-ark-plugins (Emblem 1.2).
