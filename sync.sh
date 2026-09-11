#!/bin/bash
set -e

# Sync dotfiles across machines: commit + push local changes, pull anything
# pushed elsewhere, then re-run every install.sh so the machine matches the
# repo (including re-asserting the merged AGENTS.md over Gohan's overwrite).
#
# Invoked directly, via the fish `dotfiles-sync` function, or pi's `/sync`.
# $DOTFILES_DIR overrides the repo root; default is this script's own dir.
#
# --no-push: pull --rebase on both repos and reinstall, but skip both the
# commit and the push. Local changes stay uncommitted in the working tree so
# in-progress work isn't auto-committed as "chore: sync dotfiles". The pull
# uses --autostash so a dirty tree rebases cleanly and your changes are
# reapplied afterward. Use when you want your machine's installs refreshed
# from the latest remote without shipping half-done local edits.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${DOTFILES_DIR:-$SCRIPT_DIR}"

PUSH=1
for arg in "$@"; do
	case "$arg" in
		--no-push) PUSH="" ;;
		*) echo "Unknown arg: $arg" >&2 ;;
	esac
done

# Per-run log: full stdout+stderr of every sync, so transient races and
# install failures can be diagnosed after the fact. Override with
# $DOTFILES_SYNC_LOG. Default follows XDG state dir.
LOG="${DOTFILES_SYNC_LOG:-$HOME/.local/state/dotfiles/sync.log}"
mkdir -p "$(dirname "$LOG")"

# Self-purge: drop sync runs older than 24 hours so the log can't grow
# unbounded. Trim BEFORE this run is appended — after that, `tee -a` holds
# the file open, so swapping it via `mv` would lose the in-flight tail.
# Each run begins with a `sync.sh run — <timestamp> — args:` marker; we find
# the first marker within the last 24h and keep from there. If every run is
# older than 24h, keep the most recent one so the log never goes empty.
# date flags differ between BSD (macOS) and GNU (Linux), so detect once.
is_gnu_date() { date --version >/dev/null 2>&1; }
cutoff_epoch() {
	if is_gnu_date; then date -d '24 hours ago' +%s; else date -v-24H +%s; fi
}
ts_to_epoch() {
	# $1 = "2026-09-11 08:06:34 -0700" (from the run marker).
	if is_gnu_date; then date -d "$1" +%s 2>/dev/null; else date -j -f "%Y-%m-%d %H:%M:%S %z" "$1" +%s 2>/dev/null; fi
}
trim_log() {
	[ -f "$LOG" ] || return 0
	local cutoff markers
	cutoff="$(cutoff_epoch)" || return 0
	markers="$(grep -n '^sync\.sh run — ' "$LOG")" || return 0
	local keep_line="" entry lineno marker ts epoch
	while IFS= read -r entry; do
		lineno="${entry%%:*}"
		marker="${entry#*:}"
		ts="${marker#sync.sh run — }"
		ts="${ts%% — args: *}"
		epoch="$(ts_to_epoch "$ts")"
		if [ -n "$epoch" ] && [ "$epoch" -ge "$cutoff" ]; then
			keep_line="$lineno"
			break
		fi
	done <<< "$markers"
	if [ -z "$keep_line" ]; then
		keep_line="$(printf '%s\n' "$markers" | tail -1 | cut -d: -f1)"
	fi
	# The `====` header line sits one line above the marker; start there for
	# a clean opening. Swap via temp + mv so the open `tee` fd stays valid.
	local tmp
	tmp="$(mktemp)"
	tail -n +"$((keep_line - 1))" "$LOG" > "$tmp" && mv "$tmp" "$LOG"
}
trim_log

{
	echo
	echo "=========================================================="
	echo "sync.sh run — $(date '+%Y-%m-%d %H:%M:%S %z') — args: $* — push=${PUSH:-0}"
	echo "=========================================================="
} >> "$LOG"
exec > >(tee -a "$LOG") 2>&1

# commit -> pull --rebase -> push one repo ($1 = path, $2 = label).
sync_repo() {
    local dir="$1" label="$2"
    echo "== $label ($dir)"

    if ! git -C "$dir" rev-parse --abbrev-ref '@{u}' > /dev/null 2>&1; then
        echo "  No upstream configured — skipping pull/push"
        local has_upstream=""
    else
        local has_upstream=1
    fi

    if [ -z "$PUSH" ]; then
        if [ -n "$(git -C "$dir" status --porcelain)" ]; then
            echo "  Leaving local changes uncommitted (--no-push)"
        else
            echo "  No local changes"
        fi
    elif [ -n "$(git -C "$dir" status --porcelain)" ]; then
        git -C "$dir" add -A
        git -C "$dir" commit -m "chore: sync dotfiles"
        echo "  Committed local changes"
    else
        echo "  No local changes"
    fi

    if [ -n "$has_upstream" ]; then
        # git pull --rebase refuses with "Cannot rebase onto multiple branches"
        # when branch.<branch>.merge has >1 value (a botched --set-upstream / config
        # edit). Dedupe to the first so the pull can proceed.
        local branch merges
        branch="$(git -C "$dir" rev-parse --abbrev-ref HEAD)"
        mapfile -t merges < <(git -C "$dir" config --get-all "branch.$branch.merge")
        if [ ${#merges[@]} -gt 1 ]; then
            git -C "$dir" config --unset-all "branch.$branch.merge"
            git -C "$dir" config --add "branch.$branch.merge" "${merges[0]}"
            echo "  Deduped branch.$branch.merge (had ${#merges[@]} values)"
        fi

        # `git pull --rebase` can transiently fail with "Cannot rebase onto
        # multiple branches" when another `git fetch` runs concurrently on the
        # same repo — pi's session_start out-of-date check fires a fetch on
        # every new session, so a /sync invoked shortly after session start
        # (or from another tmux pane) races it. The conflict clears in
        # seconds, so retry a few times with backoff before giving up. The
        # multi-merge dedupe above handles the persistent (botched config)
        # variant of the same error message.
        local pull_out pull_rc attempt
        for attempt in 1 2 3; do
            pull_out="$(git -C "$dir" pull --rebase --autostash 2>&1)" && pull_rc=0 || pull_rc=$?
            printf '%s\n' "$pull_out"
            if [ "$pull_rc" -eq 0 ]; then
                break
            fi
            if printf '%s' "$pull_out" | grep -q "Cannot rebase onto multiple branches"; then
                echo "  Transient fetch/pull race (attempt $attempt/3) — retrying after backoff…" >&2
                [ "$attempt" -lt 3 ] && sleep $((attempt * 2))
                continue
            fi
            break
        done
        if [ "$pull_rc" -ne 0 ]; then
            echo "Error: pull --rebase failed in $label — see $LOG, then re-run sync" >&2
            exit 1
        fi
        if [ -z "$PUSH" ]; then
            echo "  Push skipped (--no-push) — local commits stay local"
        elif [ -n "$(git -C "$dir" rev-list '@{u}..HEAD')" ]; then
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

# Update pi packages (npm:pi-subagents, etc.). pi skips already-current
# packages, so this is a no-op when nothing changed. --no-approve keeps
# project-local settings from whatever cwd sync was invoked in out of the
# update (pi update never prompts, per pi docs).
echo "== Updating pi extensions"
if command -v pi > /dev/null 2>&1; then
    if ! pi update --extensions --no-approve; then
        FAILED+=("pi-update")
        echo "  Warning: pi update --extensions failed — continuing" >&2
    fi
else
    echo "  pi not installed — skipping"
fi

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
