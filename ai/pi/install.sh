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
# A destination that exists and is NOT one of our symlinks (e.g. an extension
# dropped in directly, not yet migrated) is left alone.
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

# Symlink the shared agent-memory store into ~/.pi/agent/memory for the
# memory extension (private/ai/shared/memory/agent — one subdir per project,
# MEMORY.md index per subdir). $PI_AGENT_STORE overrides at runtime
# (resolved as <root>/memory/agent).
echo "Symlinking agent memory store..."
MEMORY_SRC="$(cd "$SCRIPT_DIR/../.." && pwd)/private/ai/shared/memory/agent"
dest="$PI_DIR/memory"
if [ -d "$MEMORY_SRC" ]; then
    if [ -L "$dest" ] && [ "$(readlink "$dest")" = "$MEMORY_SRC" ]; then
        echo "  Already linked memory"
    elif [ -L "$dest" ]; then
        rm -f "$dest"
        ln -s "$MEMORY_SRC" "$dest"
        echo "  Linked memory"
    elif [ -e "$dest" ]; then
        echo "  Skipped memory (exists, not a dotfiles symlink — leaving it alone)"
    else
        ln -s "$MEMORY_SRC" "$dest"
        echo "  Linked memory"
    fi
else
    echo "  Skipped memory (no private memory store found)"
fi

# Create the shared agent-plans dir inside the memory store for the plan-mode
# extension (private/ai/shared/memory/agent/.plans — one flat .md per plan or
# plan revision; dot-prefix sorts it above the per-project memory folders).
# Reachable in pi at ~/.pi/agent/memory/.plans via the memory symlink above —
# no separate symlink needed. $PI_AGENT_STORE overrides at runtime (resolved
# as <root>/memory/agent/.plans).
echo "Ensuring agent plans dir..."
if [ -d "$MEMORY_SRC" ]; then
    mkdir -p "$MEMORY_SRC/.plans"
    echo "  Ensured plans dir"
else
    echo "  Skipped plans (no private memory store found)"
fi
# Remove the pre-move ~/.pi/agent/plans symlink if it's still around.
if [ -L "$PI_DIR/plans" ]; then
    rm -f "$PI_DIR/plans"
    echo "  Removed stale plans symlink"
fi

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
