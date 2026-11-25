# Changelog

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
