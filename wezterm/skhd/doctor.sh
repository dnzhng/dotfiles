#!/bin/bash
# Triage the ⌥space → WezTerm hotkey. Read-only unless --fix is passed.
#
#   wezterm/skhd/doctor.sh          # diagnose
#   wezterm/skhd/doctor.sh --fix    # also restart skhd, when that's safe
#
# Two things kill this hotkey, both living in README.md → Troubleshooting:
# Secure Keyboard Entry (macOS mutes every event tap while any app holds it, and
# skhd exits if it *starts* in that state) and a daemon that isn't running.
set -uo pipefail

LABEL="com.koekeishiya.skhd"
TARGET="gui/$(id -u)/$LABEL"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
ERR_LOG="/tmp/skhd_$(whoami).err.log"
CONFIG_LINK="$HOME/.config/skhd/skhdrc"

FIX=""
for arg in "$@"; do
	case "$arg" in
		--fix) FIX=1 ;;
		-h | --help)
			sed -n '2,10p' "$0"
			exit 0
			;;
		*)
			echo "unknown argument: $arg" >&2
			exit 2
			;;
	esac
done

DEGRADED=()
note() { printf '  %-14s %s\n' "$1" "$2"; }
degrade() { DEGRADED+=("$1"); }

# Secure Keyboard Entry state: prints the pid macOS attributes it to, "unknown"
# if that can't be resolved, or nothing when it's off. Carbon +
# CGSCopyCurrentSessionDictionary are the only reliable read; ioreg shows
# nothing (both verified). Beware: the pid is only the *frontmost* app, not
# necessarily the process that enabled secure input.
secure_input_pid() {
	/usr/bin/python3 - <<'PY' 2>/dev/null
import ctypes
carbon = ctypes.CDLL("/System/Library/Frameworks/Carbon.framework/Carbon")
if not carbon.IsSecureEventInputEnabled():
    raise SystemExit(0)

cg = ctypes.CDLL("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics")
cf = ctypes.CDLL("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")

cg.CGSCopyCurrentSessionDictionary.restype = ctypes.c_void_p
cf.CFStringCreateWithCString.restype = ctypes.c_void_p
cf.CFStringCreateWithCString.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_uint32]
cf.CFDictionaryGetValue.restype = ctypes.c_void_p
cf.CFDictionaryGetValue.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
cf.CFNumberGetValue.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p]

session = cg.CGSCopyCurrentSessionDictionary()
key = cf.CFStringCreateWithCString(None, b"kCGSSessionSecureInputPID", 0x08000100)
ref = cf.CFDictionaryGetValue(ctypes.c_void_p(session), ctypes.c_void_p(key)) if session and key else None
if not ref:
    print("unknown")
    raise SystemExit(0)

num = ctypes.c_int32(0)
cf.CFNumberGetValue(ctypes.c_void_p(ref), 3, ctypes.byref(num))
print(num.value)
PY
}

job_field() { launchctl print "$TARGET" 2>/dev/null | awk -F' = ' "/^[[:space:]]*$1 = /{print \$2}"; }

echo "⌥space → WezTerm hotkey doctor — $(date '+%H:%M:%S')"
echo

if ! command -v skhd >/dev/null; then
	echo "FAIL  skhd is not installed — run wezterm/skhd/install.sh"
	exit 1
fi

if ! launchctl print "$TARGET" >/dev/null 2>&1; then
	note "daemon" "NOT loaded (no launchd job)"
	degrade "job is not loaded — run wezterm/skhd/install.sh"
	note "plist" "$([ -f "$PLIST" ] && echo present || echo MISSING)"
else
	PID="$(job_field pid)"
	RUNS="$(job_field runs)"
	EXIT="$(job_field 'last exit code')"
	if [ -n "$PID" ]; then
		note "daemon" "running (pid $PID, starts since load: ${RUNS:-?})"
	else
		note "daemon" "NOT running (starts since load: ${RUNS:-?}, last exit: ${EXIT:-?})"
		degrade "daemon is down — doctor.sh --fix once secure input is off"
	fi
	case "${EXIT:-}" in
		"" | "(never exited)" | "0") ;;
		*) note "prev exit" "$EXIT" ;;
	esac
fi

if [ -L "$CONFIG_LINK" ]; then
	note "config" "$CONFIG_LINK -> $(readlink "$CONFIG_LINK")"
else
	note "config" "MISSING (run wezterm/skhd/install.sh)"
	degrade "config is not symlinked from the repo"
fi

SEC_PID="$(secure_input_pid)"
HOLDER=""
if [ -n "$SEC_PID" ]; then
	# An app (not necessarily this one) leaked its secure-input reference count.
	HOLDER="$(ps -p "$SEC_PID" -o comm= 2>/dev/null || true)"
	note "secure input" "ON — macOS mutes every event tap while any app holds it"
	note "attributed to" "${HOLDER:-pid $SEC_PID} — just the frontmost app, not necessarily the leaker"
	degrade "secure input is stuck ON; ⌥space stays muted until the owning app releases it"
else
	note "secure input" "off"
fi

if [ -s "$ERR_LOG" ]; then
	note "abort log" "$(tail -1 "$ERR_LOG")"
	note "" "($ERR_LOG, modified $(stat -f '%Sm' -t '%H:%M:%S' "$ERR_LOG"))"
fi

if [ "${#DEGRADED[@]}" -gt 0 ]; then
	echo
	echo "Problems:"
	for msg in "${DEGRADED[@]}"; do printf '  • %s\n' "$msg"; done
fi

if [ -n "$SEC_PID" ]; then
	echo
	echo "Secure Keyboard Entry is a per-app reference count (Apple TN2150): only the"
	echo "app that enabled it can release it, so nothing outside that process clears"
	echo "it — CGSSetSecureEventInput is refused for unprivileged processes (verified)."
	echo "Deactivate/quit the candidate app (browsers leak it most: submitting or"
	echo "closing a password form), or log out; the tap resumes the moment it clears."
	echo "To catch the culprit next time: wezterm/skhd/watch-secure-input.sh"
fi

if [ -z "$FIX" ]; then
	echo
	echo "Restart it (only when secure input is off): $0 --fix"
	[ "${#DEGRADED[@]}" -eq 0 ] || exit 1
	exit 0
fi

echo
if [ -n "$SEC_PID" ]; then
	echo "Not restarting: Secure Keyboard Entry is held, so a start would only log"
	echo "'...abort..' and exit (see above). Release it first, then re-run --fix."
	exit 1
fi

BEFORE="$(wc -c <"$ERR_LOG" 2>/dev/null || echo 0)"
echo "Restarting $LABEL..."
skhd --restart-service >/dev/null 2>&1
sleep 2

NEW_PID="$(job_field pid)"
AFTER="$(wc -c <"$ERR_LOG" 2>/dev/null || echo 0)"
if [ -n "$NEW_PID" ] && [ "$AFTER" -le "$BEFORE" ]; then
	note "daemon" "restarted (pid $NEW_PID) — test ⌥space now"
	exit 0
fi

note "daemon" "did NOT come up cleanly"
tail -3 "$ERR_LOG" 2>/dev/null
echo
echo "If the log says 'must be run with accessibility access', re-grant skhd in"
echo "System Settings → Privacy & Security → Accessibility (+ Input Monitoring"
echo "if macOS asks), then re-run $0 --fix."
exit 1
