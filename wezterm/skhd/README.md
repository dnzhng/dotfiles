# skhd

Global hotkey daemon ([koekeishiya/skhd](https://github.com/koekeishiya/skhd)).
Currently binds a single hotkey: **⌥space** (option+space) to toggle WezTerm —
see `../README.md` for the toggle behavior itself.

Why skhd: macOS Services/Automator hotkeys spawn a fresh
`WorkflowServiceRunner` per press (~0.5–1.5s). skhd is a resident ~5MB daemon
that runs the command in-process, so the toggle is sub-100ms.

```
$ wezterm/skhd/install.sh
```

The installer brew-installs skhd, symlinks `skhdrc` to
`~/.config/skhd/skhdrc`, and starts the launchd service (auto-restarts on
login).

## One-time permission

skhd needs **Accessibility** access to intercept global keys:
System Settings → Privacy & Security → Accessibility → enable skhd.
macOS prompts on the first hotkey press; approve it there. (On some macOS
versions it also asks for Input Monitoring — approve that too.)

## Editing

- Edit `wezterm/skhd/skhdrc` in this repo, then `skhd --reload` (no reinstall needed).
- Key syntax reference: `skhd --help` / the skhd README. Keycodes (like
  `0x32` for backtick) can be probed with `skhd --observe`.

## Troubleshooting

- skhd runs as a launchd LaunchAgent with `KeepAlive.Crashed`, so it
  auto-restarts after a crash and on login. Manual control:
  `skhd --restart-service` / `--stop-service` / `--start-service`.
- Hotkey does nothing: check the service is running (`launchctl list | grep
  skhd` — a PID in the first column means alive) and that Accessibility is
  granted; then check the logs at `/tmp/skhd_<user>.out.log` /
  `/tmp/skhd_<user>.err.log` (a config parse error exits skhd cleanly, which
  launchd does *not* auto-restart).
- ⌥space is swallowed globally, so it won't reach other apps. Rebind here if
  that annoys.
