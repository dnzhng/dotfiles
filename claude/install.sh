#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_DIR="$(dirname "$SCRIPT_DIR")"
PRIVATE_DIR="$DOTFILES_DIR/private"
CLAUDE_DIR="$HOME/.claude"

# Ensure ~/.claude exists
mkdir -p "$CLAUDE_DIR"

# Build CLAUDE.md — base, with optional private layer appended
echo "Building CLAUDE.md..."
cp "$SCRIPT_DIR/CLAUDE.md" "$CLAUDE_DIR/CLAUDE.md"
if [ -f "$PRIVATE_DIR/claude/CLAUDE.md" ]; then
    printf '\n' >> "$CLAUDE_DIR/CLAUDE.md"
    cat "$PRIVATE_DIR/claude/CLAUDE.md" >> "$CLAUDE_DIR/CLAUDE.md"
    echo "  Merged base + private CLAUDE.md"
else
    echo "  Base CLAUDE.md only (no private layer found)"
fi

# Symlink statusline-command.sh
echo "Symlinking statusline-command.sh..."
rm -f "$CLAUDE_DIR/statusline-command.sh"
ln -s "$SCRIPT_DIR/statusline-command.sh" "$CLAUDE_DIR/statusline-command.sh"

# Symlink agent files from both base and private
echo "Symlinking agents..."
mkdir -p "$CLAUDE_DIR/agents"
for dir in "$SCRIPT_DIR/agents" "$PRIVATE_DIR/claude/agents"; do
    [ -d "$dir" ] || continue
    for agent in "$dir"/*.md; do
        [ -e "$agent" ] || continue
        name=$(basename "$agent")
        rm -f "$CLAUDE_DIR/agents/$name"
        ln -s "$agent" "$CLAUDE_DIR/agents/$name"
    done
done

# Symlink settings.local.json from private if present
if [ -f "$PRIVATE_DIR/claude/settings.local.json" ]; then
    echo "Symlinking settings.local.json from private..."
    rm -f "$CLAUDE_DIR/settings.local.json"
    ln -s "$PRIVATE_DIR/claude/settings.local.json" "$CLAUDE_DIR/settings.local.json"
fi

# Merge settings files
echo "Merging settings..."
BASE_SETTINGS="$SCRIPT_DIR/settings.base.json"
LOCAL_SETTINGS="$CLAUDE_DIR/settings.local.json"
OUTPUT_SETTINGS="$CLAUDE_DIR/settings.json"

if ! command -v jq &> /dev/null; then
    echo "Error: jq is required but not installed. Install it with:"
    echo "  brew install jq  # macOS"
    echo "  apt install jq   # Ubuntu/Debian"
    exit 1
fi

if [ -f "$LOCAL_SETTINGS" ]; then
    # Merge base with local (local overrides base)
    jq -s '.[0] * .[1]' "$BASE_SETTINGS" "$LOCAL_SETTINGS" > "$OUTPUT_SETTINGS"
    echo "  Merged settings.base.json + settings.local.json -> settings.json"
else
    # Just copy base settings
    cp "$BASE_SETTINGS" "$OUTPUT_SETTINGS"
    echo "  Base settings only (no private settings.local.json found)"
fi

# Run private install script if present
if [ -x "$PRIVATE_DIR/claude/install.sh" ]; then
    "$PRIVATE_DIR/claude/install.sh"
fi

echo "Done!"
