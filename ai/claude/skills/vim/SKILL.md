---
name: vim
description: Open vim in an 85% tmux split above the current pane. With no argument, opens the current directory (`vim .`); with a file argument (relative or absolute path), opens that file. Use when the user asks to open or edit something in vim, or invokes /vim.
---

Open vim in a tmux split.

1. Check that `$TMUX` is set. If not inside tmux, tell the user this skill requires tmux and stop.
2. Build the vim command from the skill arguments:
   - No argument: `vim .`
   - A file path (relative or absolute): `vim <path>` — shell-quote the path
     (e.g. `vim 'my file.txt'`). Relative paths resolve against the pane's
     current directory, so pass them through as given.
3. Run it in the split, e.g. for no argument:

```bash
tmux split-window -t "$TMUX_PANE" -b -p 85 -c "#{pane_current_path}" vim .
```

or with a file:

```bash
tmux split-window -t "$TMUX_PANE" -b -p 85 -c "#{pane_current_path}" vim path/to/file
```

This opens vim in a new pane taking 85% of the window above the current
pane, pinned to the window that initiated the skill (`$TMUX_PANE`) so it
can't land in whatever window happens to be active; focus stays on the
Claude pane so the conversation can continue.
4. Confirm to the user in one short line, including what was opened. Do not
edit the file yourself — the editing happens in vim, driven by the user.
