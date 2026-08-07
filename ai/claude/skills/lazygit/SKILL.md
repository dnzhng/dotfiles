---
name: lazygit
description: Open lazygit in an 85% tmux split above the current pane. With no argument, opens the pane's current directory; with a directory argument (relative or absolute, e.g. a nested repo like `private`), opens that directory. Use when the user asks to open lazygit, review changes in lazygit, or invokes /lazygit.
---

Open lazygit in a tmux split for code review.

1. Check that `$TMUX` is set. If not inside tmux, tell the user this skill requires tmux and stop.
2. Run it in the split, no argument:

```bash
tmux split-window -t "$TMUX_PANE" -b -p 85 -c "#{pane_current_path}" lazygit
```

or with a directory (relative paths resolve against the pane's cwd):

```bash
tmux split-window -t "$TMUX_PANE" -b -p 85 -c "#{pane_current_path}/private" lazygit
```

3. Confirm in one short line. The review happens in lazygit, driven by the
user — don't open files or run git commands yourself.
