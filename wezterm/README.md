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

WezTerm has no native global hotkey ([wezterm/wezterm#1751]), so visibility
toggling is done at the OS level with a native Services Quick Action —
nothing installed, nothing running in the background:

```
$ wezterm/install-toggle-macos.sh
```

This generates `~/Library/Services/Toggle WezTerm.workflow`, a thin wrapper
that runs `wezterm/toggle-wezterm.applescript` via `osascript` (so editing the
AppleScript in this repo takes effect immediately). Then one manual step:

1. System Settings → Keyboard → Keyboard Shortcuts… → Services → General →
   "Toggle WezTerm" → assign **⌃\`** (ctrl+backtick)
2. First press: macOS prompts to allow controlling System Events → OK (one-time)

Behavior: not running → launch; frontmost → hide; otherwise → unhide + focus.

Caveats:
- ~200–300ms latency vs iTerm2's built-in toggle (price of zero-install).
- Activating jumps you to the Space the window lives on (no visor pull-in).
- ⌃\` is swallowed globally, so it won't reach other apps (e.g. VS Code's
  terminal toggle). Rebind in System Settings if that annoys.
- The workflow bakes in the repo's absolute path — re-run the installer if
  the repo moves.
- If the service doesn't appear in System Settings: run
  `/System/Library/CoreServices/pbs -update`, log out/in once. Fallback:
  create the Quick Action manually in Automator ("no input", "any
  application", Run Shell Script → the same `osascript` line).

Upgrade path: swap the macOS adapter for Hammerspoon later (lower latency,
visor-style window pull-in) without touching anything else.

## OS support / future adapters

The WezTerm config itself is fully portable; only the hotkey layer is per-OS:

| OS      | Adapter                                                        |
|---------|----------------------------------------------------------------|
| macOS   | `wezterm/install-toggle-macos.sh` (this setup)                  |
| Linux   | (later) DE/WM global shortcut → xdotool/kdotool toggle script, or GNOME run-or-raise |
| Windows | (later) AutoHotkey, or flyingpie/windows-terminal-quake         |

[wezterm/wezterm#1751]: https://github.com/wezterm/wezterm/issues/1751
