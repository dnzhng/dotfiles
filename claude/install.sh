#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="$HOME/.claude"

# Ensure ~/.claude exists
mkdir -p "$CLAUDE_DIR"

# Symlink CLAUDE.md
echo "Symlinking CLAUDE.md..."
rm -f "$CLAUDE_DIR/CLAUDE.md"
ln -s "$SCRIPT_DIR/CLAUDE.md" "$CLAUDE_DIR/CLAUDE.md"

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
    echo "Merged settings.base.json + settings.local.json -> settings.json"
else
    # Just copy base settings
    cp "$BASE_SETTINGS" "$OUTPUT_SETTINGS"
    echo "Copied settings.base.json -> settings.json (no local settings found)"
    echo "Tip: Create $LOCAL_SETTINGS for machine-specific settings (see settings.local.json.example)"
fi

echo "Done!"
