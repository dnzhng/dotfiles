---
name: lazygit
description: Open lazygit in an 85% tmux split above the current pane, so the user can review code while keeping the Claude session accessible. Use when the user asks to open lazygit, review changes in lazygit, or invokes /lazygit.
---

Open lazygit in a tmux split for code review.

1. Check that `$TMUX` is set. If not inside tmux, tell the user this skill requires tmux and stop.
2. Run exactly:

```bash
tmux split-window -b -p 85 -c "#{pane_current_path}" lazygit
```

This opens lazygit in a new pane taking 85% of the window above the current
pane; focus stays on the Claude pane so the conversation can continue.
3. Confirm to the user in one short line. Do not open files or run git commands
yourself — the review happens in lazygit, driven by the user.
