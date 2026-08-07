# WezTerm

Config lives in `wezterm/wezterm.lua` and is symlinked to
`~/.config/wezterm/wezterm.lua` — the same lookup path on macOS, Linux, and
Windows, so one config works everywhere. WezTerm auto-reloads on save.

```
$ wezterm/install.sh
```

`fish/.exportsWezterm` puts `/Applications/WezTerm.app/Contents/MacOS` on PATH
(the `wezterm` CLI ships inside the app bundle); it's a no-op elsewhere and is
auto-sourced by `fish/config.fish`.

## Global hotkey (macOS)

WezTerm has no native global hotkey ([wezterm/wezterm#1751]) and its Lua API
can't register one (no OS-global input hook, no native modules), so toggling
is handled by [skhd](skhd) — a lean hotkey daemon — running an AppleScript:

```
$ wezterm/install.sh                # symlinks config + toggle script
$ wezterm/skhd/install.sh           # installs skhd, binds ⌥space
```

`wezterm/install.sh` symlinks `toggle-wezterm.applescript` into
`~/.config/wezterm/`, and `skhd/skhdrc` binds **⌥space** (option+space) to run
it via `osascript`. skhd runs the source directly — measured identical to a
precompiled `.scpt` once warm (~0.17s/press), so there's no build step; edits
to the `.applescript` take effect on the next press.

One-time permissions:
- skhd: Accessibility (macOS prompts on first hotkey press) — see
  [skhd/README](skhd).
- First *hide*: macOS prompts to let the script control System Events → OK.

Behavior: not running → launch; frontmost → hide; otherwise → unhide + focus.
Detection is shell-based (`pgrep` / `lsappinfo`) instead of System Events
queries, so a press costs ~100–200ms vs ~0.5–1.5s for the old Automator
Quick Action.

Caveat: activating jumps you to the Space the window lives on (no visor
pull-in).

Upgrade path: swap skhd for Hammerspoon later (drops the osascript spawn
entirely, enables visor-style window pull-in) without touching the toggle
logic.

## OS support / future adapters

The WezTerm config itself is fully portable; only the hotkey layer is per-OS:

| OS      | Adapter                                                        |
|---------|----------------------------------------------------------------|
| macOS   | skhd + `wezterm/toggle-wezterm.applescript` (this setup)         |
| Linux   | (later) DE/WM global shortcut → xdotool/kdotool toggle script, or GNOME run-or-raise |
| Windows | (later) AutoHotkey, or flyingpie/windows-terminal-quake         |

[wezterm/wezterm#1751]: https://github.com/wezterm/wezterm/issues/1751
