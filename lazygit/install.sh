#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ "$(uname)" = "Darwin" ]; then
    TARGET_DIR="$HOME/Library/Application Support/lazygit"
else
    TARGET_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/lazygit"
fi
TARGET="$TARGET_DIR/config.yml"
DESIRED="$SCRIPT_DIR/config.yml"

# Require lazygit and delta
if ! command -v lazygit > /dev/null; then
    echo "Error: lazygit is required but not installed."
    echo "  macOS: brew install lazygit"
    exit 1
fi
if ! command -v delta > /dev/null; then
    echo "Error: delta is required but not installed."
    echo "  macOS: brew install git-delta"
    exit 1
fi

# Symlink lazygit config.yml -> dotfiles config.yml
echo "Symlinking lazygit config.yml..."
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
