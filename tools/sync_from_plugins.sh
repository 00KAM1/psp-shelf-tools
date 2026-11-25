#!/bin/sh
# Copies Emblem's engine and its released game files from a psp-ark-plugins checkout,
# then rebuilds the engine and the page. Run after Emblem changes:
#   tools/sync_from_plugins.sh ../psp-ark-plugins
set -e
cd "$(dirname "$0")/.."
P="${1:-../psp-ark-plugins}"
cp "$P/emblem/src/em.c" "$P/emblem/src/em.h" engine/
rm -f games/*.txt
cp "$P"/emblem/games/*.txt games/
engine/build.sh
python3 tools/build.py
