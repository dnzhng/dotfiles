#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TPM_DIR="$HOME/.tmux/plugins/tpm"
TARGET="$HOME/.tmux.conf"
DESIRED="$SCRIPT_DIR/tmux.conf"

# Require git + tmux (install_plugins reads the plugin list via tmux)
for tool in git tmux; do
    if ! command -v "$tool" &> /dev/null; then
        echo "Error: $tool is required but not installed. Install it with:"
        echo "  brew install $tool   # macOS"
        echo "  apt install $tool    # Ubuntu/Debian"
        exit 1
    fi
done

# Symlink ~/.tmux.conf -> dotfiles tmux.conf
echo "Symlinking .tmux.conf..."
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

# Clone TPM (tmux plugin manager) if missing
echo "Setting up TPM..."
if [ -d "$TPM_DIR" ]; then
    echo "  TPM already present"
else
    git clone --depth 1 https://github.com/tmux-plugins/tpm "$TPM_DIR"
    echo "  Cloned TPM"
fi

# Install plugins declared in tmux.conf (resurrect, continuum, ...).
# Reads the plugin list from ~/.tmux.conf; tmux does not need to be running.
echo "Installing tmux plugins..."
"$TPM_DIR/bin/install_plugins"

# If a tmux server is already running, reload so changes take effect now
if tmux ls > /dev/null 2>&1; then
    tmux source-file "$TARGET" > /dev/null 2>&1 && echo "  Reloaded running tmux config" || true
fi

echo "Done!"
