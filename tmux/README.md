# Tmux

Config lives in `tmux/tmux.conf` and is symlinked to `~/.tmux.conf`. Session
persistence (survive reboots) is provided by [tmux-resurrect] + [tmux-continuum]
via TPM. To set everything up on a new machine:

```
$ tmux/install.sh
```

This symlinks the config, clones TPM, and installs the plugins. It's idempotent,
so it's safe to re-run after changing the plugin list in `tmux.conf`. (As a
fallback, `tmux.conf` also auto-installs TPM + plugins on first launch if they're
missing.)

After a reboot, just run `tmux` — continuum auto-restores the last session.

[tmux-resurrect]: https://github.com/tmux-plugins/tmux-resurrect
[tmux-continuum]: https://github.com/tmux-plugins/tmux-continuum
