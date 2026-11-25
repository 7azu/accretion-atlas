#!/usr/bin/env bash
# Copies the built plugin (dist/) into a vault: ./install.sh <vault>
# Settings (data.json) and the launcher folder in the vault are left alone.
set -euo pipefail
cd "$(dirname "$0")"
vault="${1:-}"
if [[ -z $vault || ! -d $vault/.obsidian ]]; then
    echo "usage: ./install.sh <vault>   (a folder with .obsidian in it)" >&2
    exit 64
fi
[[ -f dist/main.js ]] || npm run build
dest="$vault/.obsidian/plugins/accretion-atlas"
mkdir -p "$dest"
cp dist/main.js dist/manifest.json dist/styles.css "$dest/"
echo "installed to $dest"
