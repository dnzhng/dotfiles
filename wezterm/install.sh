#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="$HOME/.config/wezterm"

# Skip cleanly when wezterm isn't installed: app bundle on macOS, binary on PATH elsewhere
if [ ! -d "/Applications/WezTerm.app" ] && ! command -v wezterm > /dev/null; then
    echo "WezTerm not installed — skipping."
    echo "  macOS: download from https://wezterm.org (or brew install --cask wezterm)"
    exit 0
fi

# Symlink ~/.config/wezterm/{wezterm.lua,toggle-wezterm.applescript} -> dotfiles
# (the applescript is run directly by skhd on macOS; see skhd/skhdrc)
mkdir -p "$TARGET_DIR"
for name in wezterm.lua toggle-wezterm.applescript; do
    TARGET="$TARGET_DIR/$name"
    DESIRED="$SCRIPT_DIR/$name"
    echo "Symlinking $name..."
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
done

echo "Done!"
