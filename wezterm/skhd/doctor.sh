#!/bin/bash
# Triage the ⌥space → WezTerm hotkey. Read-only unless --fix is passed.
#
#   wezterm/skhd/doctor.sh          # diagnose
#   wezterm/skhd/doctor.sh --fix    # also restart skhd, when that's safe
#
# The usual reason the hotkey dies is Secure Keyboard Entry: macOS mutes every
# event tap while another app holds it, and skhd exits immediately if it *starts*
# in that state. See README.md → Troubleshooting for the full failure modes.
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

DEGRADED=""
note() { printf '  %-14s %s\n' "$1" "$2"; }
degrade() { DEGRADED="$DEGRADED$1"$'\n'; }

# Secure Keyboard Entry state: prints the holding pid, "unknown" if the session
# dictionary can't resolve it, or nothing when it's off. Carbon +
# CGSCopyCurrentSessionDictionary are the only reliable source (on/off); ioreg
# does not expose it.
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
	HOLDER="$(ps -p "$SEC_PID" -o comm= 2>/dev/null || true)"
	note "secure input" "ON — held by pid $SEC_PID ${HOLDER:+($HOLDER)}"
	degrade "secure input is held; ⌥space cannot fire until it is released"
elif [ "$SEC_PID" = "unknown" ]; then
	note "secure input" "ON — holder could not be resolved"
	degrade "secure input is held; ⌥space cannot fire until it is released"
else
	note "secure input" "off"
fi

if [ -s "$ERR_LOG" ]; then
	note "abort log" "$(tail -1 "$ERR_LOG")"
	note "" "($ERR_LOG, modified $(stat -f '%Sm' -t '%H:%M:%S' "$ERR_LOG"))"
fi

if [ -n "$DEGRADED" ]; then
	echo
	echo "Problems:"
	printf '  • %s\n' $DEGRADED
fi

if [ -z "$FIX" ]; then
	echo
	echo "Restart it (only when secure input is off): $0 --fix"
	[ -z "$DEGRADED" ] || exit 1
	exit 0
fi

echo
if [ -n "$SEC_PID" ]; then
	echo "Not restarting: ${HOLDER:-pid $SEC_PID} holds Secure Keyboard Entry."
	echo "skhd would log '...abort..' and exit — release it (finish the password"
	echo "prompt / unlock / quit the app) and re-run $0 --fix."
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
