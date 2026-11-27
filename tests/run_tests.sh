#!/bin/sh
# PC tests for Shelf Tools. Needs gcc, node (18 or later) and python3 with Pillow.
#   tests/run_tests.sh [path to psp-ark-plugins]   (default: ../psp-ark-plugins, if it is there)
set -e
cd "$(dirname "$0")/.."
PLUGINS="${1:-../psp-ark-plugins}"

echo "== 1. Copies from psp-ark-plugins"
if [ -d "$PLUGINS/emblem/src" ]; then
  cmp engine/em.c "$PLUGINS/emblem/src/em.c" && cmp engine/em.h "$PLUGINS/emblem/src/em.h"
  echo "engine/em.c and em.h are the plugin's"
  for f in "$PLUGINS"/emblem/games/*.txt; do cmp "$f" "games/$(basename "$f")"; done
  [ "$(ls games/*.txt | wc -l)" -eq "$(ls "$PLUGINS"/emblem/games/*.txt | wc -l)" ]
  echo "games/ is Emblem's release ($(ls games/*.txt | wc -l) files)"
else
  echo "skipped: no $PLUGINS (clone it beside this repository to check the copies)"
fi

echo "== 2. The page's engine answers like em.c built natively"
OUT=$(mktemp -d)
gcc -O1 -Wall -Iengine/shim -Iengine -o "$OUT/native" engine/em.c engine/emglue.c tests/native_driver.c
"$OUT/native" games/*.txt tests/files/*.txt > "$OUT/native.txt"
node tests/test_engine.js games/*.txt tests/files/*.txt > "$OUT/js.txt"
cmp "$OUT/native.txt" "$OUT/js.txt"
echo "identical on $(ls games/*.txt tests/files/*.txt | wc -l) files ($(wc -l < "$OUT/js.txt") lines)"
rm -rf "$OUT"

echo "== 3. The sample stick, as a folder and as a zip"
[ -d tests/sample/ms0 ] || python3 tools/make_sample_stick.py
node tests/test_stick.js

echo "== 4. Sync, on real folders"
node tests/test_sync.js

echo "== 5. The page"
python3 tools/build.py
if grep -q "</script" src/*.js; then echo "a script contains </script"; exit 1; fi
echo "all passed"
