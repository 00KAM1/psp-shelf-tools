# Changelog

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
