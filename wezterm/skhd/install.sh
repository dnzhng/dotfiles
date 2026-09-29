#!/bin/bash
# macOS-only: install skhd, symlink skhdrc, start the launchd service.
# Idempotent — safe to re-run after editing skhdrc (also run `skhd --reload`).
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="$HOME/.config/skhd"
TARGET="$TARGET_DIR/skhdrc"
DESIRED="$SCRIPT_DIR/skhdrc"

if [ "$(uname)" != "Darwin" ]; then
    echo "Error: skhd is macOS-only."
    exit 1
fi

if ! command -v skhd > /dev/null; then
    echo "Installing skhd..."
    brew install koekeishiya/formulae/skhd
fi

# Symlink ~/.config/skhd/skhdrc -> dotfiles skhdrc
echo "Symlinking skhdrc..."
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

PLIST="$HOME/Library/LaunchAgents/com.koekeishiya.skhd.plist"
[ -f "$PLIST" ] || skhd --install-service 2>/dev/null || true
BEFORE_PLIST="$(shasum "$PLIST" 2>/dev/null | awk '{print $1}')"

# skhd --install-service bakes in `Nice -20` (highest scheduler priority on
# the machine). A hotkey daemon doesn't need it, and -20 can freeze the
# machine if skhd spins after losing its CGEventTap (e.g. Accessibility
# revoked mid-flight). Strip it so launchd runs skhd at normal priority.
plutil -remove Nice "$PLIST" 2>/dev/null || true

# The stock template is KeepAlive{Crashed:true, SuccessfulExit:false}, which
# only retries *non-zero* exits — but skhd's "abort" paths exit(0) too (the
# Accessibility check uses require()), which would leave the hotkey dead until
# the next login. Keep the job alive unconditionally.
plutil -replace KeepAlive -bool YES "$PLIST" 2>/dev/null || true
AFTER_PLIST="$(shasum "$PLIST" 2>/dev/null | awk '{print $1}')"

# skhd exits immediately if another app holds Secure Keyboard Entry (macOS
# mutes every event tap while it does, so the hotkey is dead either way), and
# launchd then retries it every 10s — each retry aborting, which is the "hotkey
# dead again" loop. Wait for the holder to clear instead of feeding that loop.
# See README.md and skhd/doctor.sh.
secure_input_held() {
    /usr/bin/python3 -c 'import ctypes; raise SystemExit(0 if ctypes.CDLL("/System/Library/Frameworks/Carbon.framework/Carbon").IsSecureEventInputEnabled() else 1)' 2>/dev/null
}

if secure_input_held; then
    echo "Secure Keyboard Entry is held (screen lock / password prompt / browser?)"
    echo "  Waiting for it to clear before touching skhd..."
    waited=0
    while secure_input_held; do
        if [ "$waited" -ge "${SKHD_SECURE_INPUT_WAIT:-120}" ]; then
            echo "  Still held after ${waited}s — skipping the restart."
            echo "  Run wezterm/skhd/doctor.sh --fix once it's released."
            exit 0
        fi
        sleep 5
        waited=$((waited + 5))
    done
    echo "  Released after ${waited}s."
fi

# Plist edits only take effect when the job is bootstrapped again; kickstart
# (-k, what --restart-service uses) re-runs the already-loaded definition.
if [ "$BEFORE_PLIST" != "$AFTER_PLIST" ]; then
    echo "Reloading launchd job (plist changed)..."
    skhd --stop-service > /dev/null 2>&1 || true
    skhd --start-service > /dev/null 2>&1 || true
else
    skhd --restart-service > /dev/null 2>&1 || skhd --start-service > /dev/null 2>&1 || true
fi

if launchctl print "gui/$(id -u)/com.koekeishiya.skhd" > /dev/null 2>&1; then
    echo "skhd service running"
else
    echo "skhd service NOT running — run wezterm/skhd/doctor.sh"
fi

echo ""
echo "Done!"
echo ""
echo "Manual step (one-time, per machine): grant skhd Accessibility access."
echo "  System Settings -> Privacy & Security -> Accessibility -> enable skhd"
echo "  (macOS prompts on the first hotkey press; approve it there)."
