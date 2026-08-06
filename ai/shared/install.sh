#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PRIVATE_SHARED="$DOTFILES_DIR/private/ai/shared"

# Build merged AGENTS.md — base, with optional private layer appended
echo "Building AGENTS.md..."
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
cp "$SCRIPT_DIR/AGENTS.md" "$TMP"
if [ -f "$PRIVATE_SHARED/AGENTS.md" ]; then
    printf '\n' >> "$TMP"
    cat "$PRIVATE_SHARED/AGENTS.md" >> "$TMP"
    echo "  Merged base + private AGENTS.md"
else
    echo "  Base AGENTS.md only (no private layer found)"
fi

# Distribute to each tool's config location. Every tool reads AGENTS.md natively
# (Gemini included), so we use that filename everywhere for consistency.
DESTINATIONS=(
    "$HOME/.claude/AGENTS.md"
    "$HOME/.config/opencode/AGENTS.md"
    "$HOME/.pi/agent/AGENTS.md"
    "$HOME/.gemini/AGENTS.md"
)

echo "Distributing AGENTS.md..."
for dest in "${DESTINATIONS[@]}"; do
    # Only seed tools that are set up (config dir exists) — don't create dirs for
    # uninstalled tools. Re-run this script after installing a new tool to seed it.
    if [ -d "$(dirname "$dest")" ]; then
        cp "$TMP" "$dest"
        echo "  Wrote $dest"
    else
        echo "  Skipped $dest (tool config dir not found)"
    fi
done

echo "Done!"
