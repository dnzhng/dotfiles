# Clear stuck mouse-reporting mode left behind when an SSH session drops
# mid-tmux (tmux's `mouse on` never gets to send the "off" sequence), which
# otherwise makes every mouse move type escape garbage. Full `reset` also
# works but clears the screen; these only disable the tracking modes.
# Also available on demand via fix-mouse, for a tab that's still open after
# the drop (no new shell starts there, so the startup printf never re-runs).
fix-mouse() {
  printf '\e[?1000l\e[?1002l\e[?1003l\e[?1005l\e[?1006l\e[?1004l\e[?9l'
}
fix-mouse
