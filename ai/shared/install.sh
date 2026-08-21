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

# Symlink shared skill dirs into ~/.claude/skills, one symlink per skill.
# opencode auto-loads ~/.claude/skills as external skills, so this single
# target covers both Claude Code and opencode — deliberately NOT seeding
# ~/.config/opencode/skills too, which would double-load them.
echo "Symlinking skills..."
if [ -d "$HOME/.claude" ]; then
    mkdir -p "$HOME/.claude/skills"
    # Prune links into our skills dir whose targets were removed (e.g. a skill
    # converted to plain AGENTS.md instructions).
    for link in "$HOME/.claude/skills"/*; do
        [ -L "$link" ] || continue
        target="$(readlink "$link")"
        case "$target" in
            "$SCRIPT_DIR/skills"/*)
                if [ ! -e "$target" ]; then
                    rm -f "$link"
                    echo "  Pruned stale link $(basename "$link")"
                fi
                ;;
        esac
    done
    for skill in "$SCRIPT_DIR/skills"/*/; do
        [ -d "$skill" ] || continue
        name=$(basename "$skill")
        dest="$HOME/.claude/skills/$name"
        if [ -L "$dest" ]; then
            rm -f "$dest"
        elif [ -e "$dest" ]; then
            echo "  Skipped $name (exists, not a dotfiles symlink — leaving it alone)"
            continue
        fi
        ln -s "${skill%/}" "$dest"
        echo "  Linked $name"
    done
else
    echo "  Skipped skills (~/.claude not found)"
fi

# Symlink shared bin scripts into ~/.local/bin (on PATH), so they're callable
# directly from any harness or shell — e.g. `! tmux-split-window lazygit` in
# Claude Code. A destination that exists and is NOT one of our symlinks is
# left alone.
echo "Symlinking bin scripts..."
mkdir -p "$HOME/.local/bin"
# Prune links into our bin dir whose targets were removed or renamed.
for link in "$HOME/.local/bin"/*; do
    [ -L "$link" ] || continue
    target="$(readlink "$link")"
    case "$target" in
        "$SCRIPT_DIR/bin"/*)
            if [ ! -e "$target" ]; then
                rm -f "$link"
                echo "  Pruned stale link $(basename "$link")"
            fi
            ;;
    esac
done
for script in "$SCRIPT_DIR/bin"/*; do
    [ -f "$script" ] || continue
    name=$(basename "$script")
    dest="$HOME/.local/bin/$name"
    if [ -L "$dest" ]; then
        rm -f "$dest"
    elif [ -e "$dest" ]; then
        echo "  Skipped $name (exists, not a dotfiles symlink — leaving it alone)"
        continue
    fi
    ln -s "$script" "$dest"
    echo "  Linked $name"
done

echo "Done!"
