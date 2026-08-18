#!/bin/bash
set -e

# Sync dotfiles across machines: commit + push local changes, pull anything
# pushed elsewhere, then re-run every install.sh so the machine matches the
# repo (including re-asserting the merged AGENTS.md over Gohan's overwrite).
#
# Invoked directly, via the fish `dotfiles-sync` function, or pi's `/sync`.
# $DOTFILES_DIR overrides the repo root; default is this script's own dir.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${DOTFILES_DIR:-$SCRIPT_DIR}"

# commit -> pull --rebase -> push one repo ($1 = path, $2 = label).
sync_repo() {
    local dir="$1" label="$2"
    echo "== $label ($dir)"

    if ! git -C "$dir" rev-parse --abbrev-ref '@{u}' > /dev/null 2>&1; then
        echo "  No upstream configured — skipping pull/push (committing only)"
        local has_upstream=""
    else
        local has_upstream=1
    fi

    if [ -n "$(git -C "$dir" status --porcelain)" ]; then
        git -C "$dir" add -A
        git -C "$dir" commit -m "chore: sync dotfiles"
        echo "  Committed local changes"
    else
        echo "  No local changes"
    fi

    if [ -n "$has_upstream" ]; then
        if ! git -C "$dir" pull --rebase --autostash; then
            echo "Error: rebase conflict in $label — resolve it, then re-run sync" >&2
            exit 1
        fi
        if [ -n "$(git -C "$dir" rev-list '@{u}..HEAD')" ]; then
            git -C "$dir" push
            echo "  Pushed"
        else
            echo "  Already up to date with remote"
        fi
    fi
}

sync_repo "$ROOT" "dotfiles"
if [ -d "$ROOT/private/.git" ]; then
    sync_repo "$ROOT/private" "dotfiles-private"
else
    echo "== dotfiles-private — skipped (no private/.git)"
fi

# Re-run every install script. Each is idempotent; a missing tool on this
# machine (e.g. wezterm on bento) warns and continues instead of aborting.
echo "== Reinstalling"
FAILED=()
for script in ai/shared ai/claude ai/pi tmux vim lazygit wezterm; do
    echo "-- $script/install.sh"
    if ! "$ROOT/$script/install.sh"; then
        FAILED+=("$script")
        echo "  Warning: $script/install.sh failed — continuing" >&2
    fi
done

# Verify the merged AGENTS.md actually landed (Gohan overwrite re-asserted).
echo "== Verifying AGENTS.md"
EXPECTED="$(mktemp)"
trap 'rm -f "$EXPECTED"' EXIT
cp "$ROOT/ai/shared/AGENTS.md" "$EXPECTED"
if [ -f "$ROOT/private/ai/shared/AGENTS.md" ]; then
    printf '\n' >> "$EXPECTED"
    cat "$ROOT/private/ai/shared/AGENTS.md" >> "$EXPECTED"
fi
for dest in "$HOME/.pi/agent/AGENTS.md" "$HOME/.claude/AGENTS.md"; do
    if [ -f "$dest" ] && cmp -s "$EXPECTED" "$dest"; then
        echo "  Verified $dest"
    else
        echo "  Warning: $dest does not match the merged build" >&2
        FAILED+=("agents-md:$dest")
    fi
done

echo
if [ ${#FAILED[@]} -gt 0 ]; then
    echo "Sync finished with warnings: ${FAILED[*]}" >&2
    exit 1
fi
echo "Sync complete!"
