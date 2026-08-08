#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PI_DIR="$HOME/.pi/agent"

if [ ! -d "$PI_DIR" ]; then
    echo "Error: $PI_DIR not found — is pi installed?"
    exit 1
fi

# Symlink theme files into ~/.pi/agent/themes, one symlink per theme.
echo "Symlinking pi themes..."
mkdir -p "$PI_DIR/themes"
for theme in "$SCRIPT_DIR/themes"/*.json; do
    [ -e "$theme" ] || continue
    name=$(basename "$theme")
    dest="$PI_DIR/themes/$name"
    if [ -L "$dest" ] && [ "$(readlink "$dest")" = "$theme" ]; then
        echo "  Already linked $name"
        continue
    fi
    if [ -e "$dest" ] || [ -L "$dest" ]; then
        echo "  Existing $dest found; backing up to $dest.bak"
        mv "$dest" "$dest.bak"
    fi
    ln -s "$theme" "$dest"
    echo "  Linked $name"
done

# Symlink extensions into ~/.pi/agent/extensions, one symlink per extension.
# A destination that exists and is NOT one of our symlinks (e.g. plan-mode,
# dropped in directly) is left alone.
echo "Symlinking pi extensions..."
mkdir -p "$PI_DIR/extensions"
for ext in "$SCRIPT_DIR/extensions"/*; do
    [ -e "$ext" ] || continue
    name=$(basename "$ext")
    dest="$PI_DIR/extensions/$name"
    if [ -L "$dest" ] && [ "$(readlink "$dest")" = "$ext" ]; then
        echo "  Already linked $name"
        continue
    fi
    if [ -L "$dest" ]; then
        rm -f "$dest"
    elif [ -e "$dest" ]; then
        echo "  Skipped $name (exists, not a dotfiles symlink — leaving it alone)"
        continue
    fi
    ln -s "$ext" "$dest"
    echo "  Linked $name"
done

# Merge settings: layer the dotfiles base over the existing settings.json.
# Never overwrite the whole file — pi rewrites it at runtime with
# machine-local keys (defaultProvider, enabledModels, lastChangelogVersion),
# which must survive. Keys defined in the base win; `packages` is unioned so
# packages installed on one machine aren't lost on the next install run.
echo "Merging settings..."
BASE_SETTINGS="$SCRIPT_DIR/settings.base.json"
SETTINGS="$PI_DIR/settings.json"

command -v jq >/dev/null || { echo "Error: jq is required (brew/apt install jq)"; exit 1; }

inputs=()
[ -f "$SETTINGS" ] && inputs+=("$SETTINGS")
inputs+=("$BASE_SETTINGS")

if jq -s '
  def union: reduce .[] as $x ([]; if any(.[]; . == $x) then . else . + [$x] end);
  (reduce .[] as $o ({}; . * $o)) as $m
  | ([.[].packages // []] | add // [] | union) as $pkgs
  | $m | .packages = $pkgs
' "${inputs[@]}" > "$SETTINGS.tmp"; then
    mv "$SETTINGS.tmp" "$SETTINGS"
    echo "  Merged ${#inputs[@]} layer(s) -> settings.json (machine-local keys preserved)"
else
    rm -f "$SETTINGS.tmp"
    echo "Error: jq failed to merge settings; left settings.json unchanged" >&2
    exit 1
fi

echo "Done! Select a theme in pi via /settings (edits hot-reload while it's active); run /reload to pick up extensions."
