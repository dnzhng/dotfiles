#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="$HOME/.config/wezterm"
TARGET="$TARGET_DIR/wezterm.lua"
DESIRED="$SCRIPT_DIR/wezterm.lua"

# Require wezterm: app bundle on macOS, binary on PATH elsewhere
if [ ! -d "/Applications/WezTerm.app" ] && ! command -v wezterm > /dev/null; then
    echo "Error: WezTerm is required but not installed."
    echo "  macOS: download from https://wezterm.org (or brew install --cask wezterm)"
    exit 1
fi

# Symlink ~/.config/wezterm/wezterm.lua -> dotfiles wezterm.lua
echo "Symlinking wezterm.lua..."
mkdir -p "$TARGET_DIR"
if [ -L "$TARGET" ] && [ "$(readlink "$TARGET")" = "$DESIRED" ]; then
    echo "  Already linked"
else
    if [ -e "$TARGET" ] || [ -L "$TARGET" ]; then
        echo "  Existing $TARGET found; backing up to $TARGET.bak"
        mv "$TARGET" "$TARGET.bak"
    fi
    ln -s "$DESIRED" "$TARGET"
    echo "  Linked $TARGET -> $DESIRED"
fi

echo "Done!"
