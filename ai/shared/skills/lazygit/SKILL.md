---
name: lazygit
description: Open lazygit in an 85% tmux split above the current pane. With no argument, opens the pane's current directory; with a directory argument (relative or absolute, e.g. a nested repo like `private`), opens that directory. Use when the user asks to open lazygit, review changes in lazygit, or invokes /lazygit.
---

Open lazygit in a tmux split for code review.

1. Check that `$TMUX` is set. If not inside tmux, tell the user this skill requires tmux and stop.
2. Build the working directory from the skill arguments:
   - No argument: the current directory (`$PWD`).
   - A directory path (relative or absolute): that directory. Relative paths
     resolve against `$PWD` (e.g. argument `private` → `"$PWD/private"`).
     Shell-quote paths containing spaces.

   Resolve the directory to a literal path in the shell before invoking
   tmux. Do NOT use tmux's `#{pane_current_path}` — it expands against
   whichever pane is active when tmux runs the command, so if the user has
   switched windows in the meantime, lazygit opens the wrong repo.
3. Run it in the split, e.g. for no argument:

```bash
tmux split-window -t "$TMUX_PANE" -b -p 85 -c "$PWD" lazygit
```

or with a directory:

```bash
tmux split-window -t "$TMUX_PANE" -b -p 85 -c "$PWD/private" lazygit
```

This opens lazygit in a new pane taking 85% of the window above the current
pane, pinned to the window that initiated the skill (`$TMUX_PANE`) so it
can't land in whatever window happens to be active; focus stays on the
agent pane so the conversation can continue.
4. Confirm to the user in one short line, including which directory was
   opened. The review happens in lazygit, driven by the user — don't open
   files or run git commands yourself.
