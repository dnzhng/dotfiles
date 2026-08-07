#!/bin/bash
# macOS-only: install skhd, symlink skhdrc, start the launchd service.
# Idempotent — safe to re-run after editing skhdrc (also run `skhd --reload`).
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="$HOME/.config/skhd"
TARGET="$TARGET_DIR/skhdrc"
DESIRED="$SCRIPT_DIR/skhdrc"

if [ "$(uname)" != "Darwin" ]; then
    echo "Error: skhd is macOS-only."
    exit 1
fi

if ! command -v skhd > /dev/null; then
    echo "Installing skhd..."
    brew install koekeishiya/formulae/skhd
fi

# Symlink ~/.config/skhd/skhdrc -> dotfiles skhdrc
echo "Symlinking skhdrc..."
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

# Start (or restart) the launchd service
if skhd --restart-service > /dev/null 2>&1; then
    echo "skhd service restarted"
else
    skhd --start-service
    echo "skhd service started"
fi

echo ""
echo "Done!"
echo ""
echo "Manual step (one-time, per machine): grant skhd Accessibility access."
echo "  System Settings -> Privacy & Security -> Accessibility -> enable skhd"
echo "  (macOS prompts on the first hotkey press; approve it there)."
