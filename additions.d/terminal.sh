# Clear stuck mouse-reporting mode left behind when an SSH session drops
# mid-tmux (tmux's `mouse on` never gets to send the "off" sequence), which
# otherwise makes every mouse move type escape garbage. Full `reset` also
# works but clears the screen; these only disable the tracking modes.
printf '\e[?1000l\e[?1002l\e[?1003l\e[?1005l\e[?1006l'
