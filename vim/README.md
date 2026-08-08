# Vim

Config lives in `vim/vimrc` and is symlinked to `~/.vim/vimrc` — Vim's fallback
for `~/.vimrc`, so no separate `~/.vimrc` is needed. Plugins are native Vim 8
packages cloned into `~/.vim/pack/plugins/start/` at install time rather than
vendored here — same philosophy as tmux/TPM: config is tracked, plugins are
fetched.

```
$ vim/install.sh
```

This symlinks the config, then shallow-clones each plugin in the list. It's
idempotent — existing plugins are skipped, so it's safe to re-run after adding a
new one.

- **Add a plugin**: append a `"name https://github.com/owner/repo.git"` entry to
  the `PLUGINS` array in `vim/install.sh`, then re-run it.
- **Update a plugin**: `git -C ~/.vim/pack/plugins/start/<name> pull` (or delete
  the directory and re-run the installer).

Plugins in use: base16-vim (colorscheme), vim-airline (+themes), vim-fugitive,
vim-gitgutter, fzf (+fzf.vim), ag.vim, vim-slim. The colorscheme is base16-ocean;
`vimrc` themes the terminal to match while vim runs, scoped per-pane when tmux
is present (tmux `window-style` + `pane-colours` on vim's pane — no
terminal-wide OSC, so sibling panes/windows keep their stock colors, and the
explicit bg renders opaque under WezTerm's `window_background_opacity`).
Outside tmux it falls back to a terminal-wide OSC palette swap, restored on
exit. The palette is the canonical base16 16-color mapping (slot 10 = base01,
11 = base02, ...) — required for base16-vim's cterm colors to render as
designed, e.g. CursorLine as a subtle dark bar instead of bright green.
