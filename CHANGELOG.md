# Changelog

## 1.5

Nothing to install: the site updates itself. If you keep a copy for offline use, replace its `index.html`.

Three new tools, all of which only read, and a new order for the tabs: Recap, Sync, Library, Backlog, Checkup, Emblem Workshop.

- **Library.** Every game on the Memory Stick with its icon, disc ID, format, size, time played and last play; search, filters and sorting; and what is worth a look: a file cut short in copying, a game that is there twice, games Shelf has not scanned, files that are gone. Shelf's favourite, completed and hidden marks are shown. It only shows: nothing on the Memory Stick is changed.
- **Backlog.** What you are playing, suggestions for what to play next with their reasons, 22 series in the order to play them, and lists of what you started and left, never started and completed. It only shows: nothing to set, nothing changed, nothing kept.
- The Library's list is quick by design: a game Shelf has scanned is not opened at all, a game it has not is read in a few small pieces (ISO, CSO and ZSO), and the check for files cut short reads about 2 KB of each game after the list is shown.
- **Checkup.** It reads what is installed on the Memory Stick and says what does not fit together: the version and build of each plugin and of Shelf, the release each file is from, whether a newer release is out (asking you to delete any Sidequest states before you update), what is missing from or wrong in ARK's `PLUGINS.TXT` (with the line to use), PSP and PS Vita builds mixed up, Extra memory on with Sidequest, Shelf's launcher copy out of step, and Sidequest states that are refused or older than what is installed. **Copy the report** gives it as text for a bug report. It only reads.
- Loading a Memory Stick now also lists the games in `ISO` and `PSP/GAME`, and reads the installed plugins and their list in `SEPLUGINS`, Scanline's log, ARK's files in `PSP/SAVEDATA/ARK_01234` and Shelf's program. Pick the drive itself: a zip of the five data folders does not hold the plugins, and the Library then shows only what Shelf has scanned, without sizes.
- The row of tabs scrolls sideways on a phone.
- **The Library, the Backlog and Checkup have not yet been run on a real Memory Stick.** They have been run on the sample; for Checkup, also on made-up setups, and the real files of every release so far were read and matched.
- Recap, the Emblem Workshop and Sync are unchanged.

## 1.4

Nothing to install: the site updates itself. If you keep a copy for offline use, replace its `index.html`.

- **Sync, a third tool.** It keeps game saves, Emblem's achievements and game files, Checkpoint's journey and time played, and Shelf's favourites and completed marks level between your PSPs and PS Vitas. Each device is synced with a vault, a folder on your computer; the page shows what would move before anything is written. A save changed on two devices is yours to choose, nothing is deleted, and a save that is replaced is kept in the vault. Sidequest's states are left alone.
- Sync needs Chrome, Edge or another Chromium browser on a computer (in Brave, with File System Access API switched on under `brave://flags`). **It has not yet been run on a real Memory Stick or PS Vita**: copy `PSP/SAVEDATA` from each device to your computer before your first sync. **Try it on the sample** shows how it works without touching anything.
- Since the release (2026-11-27, documentation only): Sync has been run in Chrome and Chromium on a real PSP Memory Stick and a real PS Vita `pspemu` folder, over USB and with the card in the computer, and works, and Recap and the Emblem Workshop have been tried in Firefox as well. The "Tested on" lines say so.
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
