#!/usr/bin/env bash
set -eu
# Desktop launcher of Accretion Atlas (plugin setting "Desktop launcher", Linux). The plugin writes this
# folder into its own folder inside the vault and a desktop entry that runs this script.
#
# Opens the vault's galaxy as a window of its own. With Quickshell and Hyprland a loading screen
# (Launch.qml) covers the start of Obsidian and opens from the black hole once the galaxy is drawn;
# without them Obsidian simply opens the galaxy.
#
# Obsidian gives a vault an ID per machine: look it up by the path, otherwise use the vault's name
# (the URI understands both).
here=$(dirname "$(realpath "$0")")
vault_dir=$(realpath "$here/../../../..")
vault=$(jq -r --arg p "$vault_dir" '.vaults | to_entries[] | select((.value.path | rtrimstr("/")) == $p) | .key' \
    "${XDG_CONFIG_HOME:-$HOME/.config}/obsidian/obsidian.json" 2>/dev/null | head -n1 || true)
[[ -n $vault ]] || vault=$(basename "$vault_dir")
uri="obsidian://accretion-atlas?vault=$vault"

open_uri() {
    if command -v obsidian >/dev/null 2>&1; then
        obsidian "$1"
    else
        xdg-open "$1"
    fi
}

if [[ ${1:-} == --open ]]; then
    : > "$ATLAS_START_DIR/launched"
    open_uri "${uri}&transition=${ATLAS_START_DIR##*/}"
    exit 0
fi

# The loading screen needs Wayland, Quickshell and Hyprland
if [[ -z ${WAYLAND_DISPLAY:-} || -z ${XDG_RUNTIME_DIR:-} ]] || ! command -v qs >/dev/null 2>&1 || ! command -v hyprctl >/dev/null 2>&1; then
    open_uri "$uri"
    exit 0
fi
exec 9>"$XDG_RUNTIME_DIR/accretion-atlas-launch.lock"
flock -n 9 || exit 0
export ATLAS_START_DIR
ATLAS_START_DIR=$(mktemp -d "$XDG_RUNTIME_DIR/accretion-atlas.XXXXXXXXXX")
trap 'rm -f -- "$ATLAS_START_DIR/status" "$ATLAS_START_DIR/launched" "$ATLAS_START_DIR/preview.webp" "$ATLAS_START_DIR/preview.tmp"; rmdir -- "$ATLAS_START_DIR"' EXIT
: > "$ATLAS_START_DIR/status"
export ATLAS_LAUNCH_SCRIPT
ATLAS_LAUNCH_SCRIPT=$(realpath "$0")
export ATLAS_MONITOR ATLAS_GAP
ATLAS_MONITOR=$(hyprctl -j monitors 2>/dev/null | jq -c '.[] | select(.focused)' 2>/dev/null || true)
gap=$(hyprctl -j getoption general:gaps_out 2>/dev/null | jq -r '(.custom // .int // "") | tostring | scan("^[0-9]+")' 2>/dev/null || true)
border=$(hyprctl -j getoption general:border_size 2>/dev/null | jq -r '.int // 1' 2>/dev/null || true)
ATLAS_GAP=$((${gap:-15} + ${border:-1}))
export ATLAS_REDUCED_MOTION
ATLAS_REDUCED_MOTION=$(gsettings get org.gnome.desktop.interface enable-animations 2>/dev/null || true)
timeout 65s qs -p "$(dirname "$ATLAS_LAUNCH_SCRIPT")/Launch.qml" 9>&- || true
if [[ ! -f "$ATLAS_START_DIR/launched" ]]; then
    open_uri "$uri" 9>&- &
fi
