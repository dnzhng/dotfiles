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

# Merge settings: layer dotfiles over the existing settings.json (do not overwrite).
echo "Merging settings..."
BASE_SETTINGS="$SCRIPT_DIR/settings.base.json"
LOCAL_SETTINGS="$CLAUDE_DIR/settings.local.json"
OUTPUT_SETTINGS="$CLAUDE_DIR/settings.json"

command -v jq >/dev/null || { echo "Error: jq is required (brew/apt install jq)"; exit 1; }

# Precedence order (rightmost wins for scalars/objects):
# existing settings.json (preserves gohan + runtime keys) < base < local
inputs=()
[ -f "$OUTPUT_SETTINGS" ] && inputs+=("$OUTPUT_SETTINGS")
inputs+=("$BASE_SETTINGS")
[ -f "$LOCAL_SETTINGS" ] && inputs+=("$LOCAL_SETTINGS")

# Deep-merge layers, order-preserving-union the three permission arrays (nothing
# runtime-added is lost), and strip top-level _-prefixed annotation keys. Atomic write
# via temp file; abort loudly if jq fails so the existing settings.json is never clobbered.
if jq -s '
  def odedupe: reduce .[] as $x ([]; if any(.[]; . == $x) then . else . + [$x] end);
  (reduce .[] as $o ({}; . * $o)) as $m
  | ([.[].permissions.allow // []] | add // [] | odedupe) as $allow
  | ([.[].permissions.deny  // []] | add // [] | odedupe) as $deny
  | ([.[].permissions.ask   // []] | add // [] | odedupe) as $ask
  | $m
  | .permissions.allow = $allow
  | .permissions.deny  = $deny
  | .permissions.ask   = $ask
  | with_entries(select(.key | startswith("_") | not))
' "${inputs[@]}" > "$OUTPUT_SETTINGS.tmp"; then
    mv "$OUTPUT_SETTINGS.tmp" "$OUTPUT_SETTINGS"
    echo "  Merged ${#inputs[@]} layer(s) -> settings.json (existing keys preserved)"
else
    rm -f "$OUTPUT_SETTINGS.tmp"
    echo "Error: jq failed to merge settings; left existing settings.json unchanged" >&2
    exit 1
fi

# Run private install script if present
if [ -x "$PRIVATE_DIR/claude/install.sh" ]; then
    "$PRIVATE_DIR/claude/install.sh"
fi

echo "Done!"
