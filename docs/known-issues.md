# Shelf Tools 1.1: known issues and limits

Tried in Chrome on a computer and at phone size, with the sample Memory Stick. **It has not yet read a real Memory Stick.** The formats it reads are taken from the plugins' and Shelf's source, and the tests build files in exactly those formats, but a real stick may hold something the tests do not.

## Disclosure

Shelf Tools was written by Claude, Anthropic’s AI model, from my ideas and my testing with files from my PSP-3000. I’m not a web developer, and nothing has been tested beyond my own setup.

- No one else has reviewed the code.
- It only reads. It never writes to the Memory Stick. A file it cannot read is skipped, and the Load window says which.
- Nothing leaves the browser: there is no server behind the page, and GitHub only serves the page itself.

## Recap

- **Runtime's dates have no year.** `battery.log` and `battery_use.log` say "Tue Nov 24 03:30". Recap works the year out from the weekday, reading back from the date the file was last changed. A clock set to the wrong date on the PSP gives wrong years.
- **Time played is the larger of two counts**, Checkpoint's and Runtime's (see [how it works](how-it-works.md#time-played)). Checkpoint counts PSP games only, so PS1 games and homebrew have hours only with Runtime.
- **Checkpoint's time in a period** comes from the running total in its journey lines. Play after a game's last journey line counts in the period of that game's last activity.
- **The busiest day and the calendar** for a game Runtime has not seen put the play between two journey lines on the day of the second.
- **The safety net** shows the Sidequest slots on the Memory Stick now, whatever period is picked.
- **The session in progress** is counted up to Runtime's last look at the clock, which it takes every two minutes.
- **Battery per hour** uses power-ons of 20 minutes or more that ended lower than they started.
- **The share picture** cannot be downloaded from inside some viewers (an embedded preview, for example). Press and hold it, or right-click it, to save it.

## Emblem Workshop

- **The engine is Emblem 1.2's.** A newer Emblem may read files differently until this page is rebuilt with `tools/sync_from_plugins.sh`.
- **Comments.** The row views keep a comment that follows a rule, written back as `   # comment`, and leave comment lines alone. Other spacing in an edited line is tidied.
- **Memory dumps** are run as given: 24 MB from `0x08800000`, or 32 MB or more from `0x08000000`. A dump taken while the game was loading or on its title screen shows nothing useful.
- **Your work is kept** in the browser's storage for this page. Clearing the site's data loses an undownloaded file.

## Loading

- **Dropped folders** need a browser that hands dropped folders to a page, as current Chrome, Edge, Firefox and Safari do. The reading is covered by the PC tests; a real drop in each browser is not. If a drop does nothing, use Pick a folder or Pick a zip.

- **Phones** often cannot pick a folder; use a zip. iPhone and iPad: Files app, select the five folders, Compress.
- **Zips:** stored and deflated entries, zip64 included. Other compression methods are refused with a message.
- **The fonts** load from Google Fonts. Offline, the page uses your system's fonts.

## When something is wrong

The page keeps no log. A line it cannot make sense of is skipped and the rest of the file still counts. A file that cannot be read at all is skipped and named under the Load buttons. The browser's console (F12) shows any script error.
