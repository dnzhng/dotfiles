#!/bin/bash
# Record Secure Keyboard Entry transitions with context, so the app that leaks
# it can be identified after the fact.
#
#   wezterm/skhd/watch-secure-input.sh            # leave it running in a pane
#   tail -f ~/Library/Logs/skhd-secure-input.log  # ...and read it anywhere
#
# Why: secure input is a per-app reference count (Apple TN2150). While any app
# leaks it, macOS mutes every event tap — skhd included — so ⌥space dies, and
# only the owning process can release it. The pid macOS reports
# (kCGSSessionSecureInputPID) is just the frontmost app, so it can't name the
# leaker; this watcher captures what else changed at the moment it flipped.
set -uo pipefail

LOG="${SKHD_SECURE_INPUT_LOG:-$HOME/Library/Logs/skhd-secure-input.log}"
INTERVAL="${SKHD_SECURE_INPUT_INTERVAL:-0.25}"
mkdir -p "$(dirname "$LOG")"

# Prints "1 <attributed-pid>" while secure input is on, else "0 -".
state() {
	/usr/bin/python3 - <<'PY' 2>/dev/null || echo "0 -"
import ctypes
carbon = ctypes.CDLL("/System/Library/Frameworks/Carbon.framework/Carbon")
if not carbon.IsSecureEventInputEnabled():
    print("0 -")
    raise SystemExit(0)
cf = ctypes.CDLL("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")
cg = ctypes.CDLL("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics")
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
    print("1 unknown")
    raise SystemExit(0)
num = ctypes.c_int32(0)
cf.CFNumberGetValue(ctypes.c_void_p(ref), 3, ctypes.byref(num))
print(f"1 {num.value}")
PY
}

snapshot() {
	echo "  front:  $(lsappinfo info -only bundleid "$(lsappinfo front)" 2>/dev/null | sed 's/.*="\(.*\)"/\1/')"
	# A password prompt shows up as the foreground process on a terminal tty.
	ps -Ao tty=,stat=,pid=,command= 2>/dev/null |
		awk '$1 ~ /^ttys/ && $2 ~ /\+/ {printf "  tty fg: %s pid %s %s\n", $1, $3, substr($0, index($0, $4))}' |
		cut -c1-140 | head -6
	# Newest pids ≈ most recently spawned processes.
	ps -Ao pid=,command= 2>/dev/null | sort -rn | head -3 |
		awk '{pid=$1; $1=""; printf "  newest: pid %s %s\n", pid, substr($0, 2)}' | cut -c1-140
}

echo "watching secure input every ${INTERVAL}s → $LOG"
echo "$(date '+%Y-%m-%d %H:%M:%S') watcher started (interval ${INTERVAL}s)" >>"$LOG"

prev=""
while :; do
	cur="$(state)"
	if [ "$cur" != "$prev" ]; then
		stamp="$(date '+%Y-%m-%d %H:%M:%S')"
		if [ "${cur%% *}" = "1" ]; then
			banner="SECURE INPUT ON  (attributed pid ${cur#1 })"
		else
			banner="secure input off"
		fi
		{
			echo "$stamp $banner"
			snapshot
		} | tee -a "$LOG"
		prev="$cur"
	fi
	sleep "$INTERVAL"
done
