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

Start here — it checks the daemon, the config link, Secure Keyboard Entry and
the abort log, and can restart the daemon when that's safe:

```
$ wezterm/skhd/doctor.sh          # diagnose (read-only)
$ wezterm/skhd/doctor.sh --fix    # restart skhd, only when secure input is off
```

### Secure Keyboard Entry is what usually kills the hotkey

macOS mutes **every** event tap while any app holds Secure Keyboard Entry, and
skhd **exits immediately if it starts in that state** — its `error()` calls
`exit()` (upstream master behaves the same):

```
skhd: secure keyboard entry is enabled by (1584) 'arc'! abort..
```

Two shapes, same cause:

- **Key ignored, daemon alive.** A holder is active right now, so the tap is
  muted. Finish the password prompt / unlock the screen / quit the app and the
  key works again by itself — no restart needed.
- **Daemon dead.** skhd was (re)started while a holder was active (login,
  `brew upgrade`, `--restart-service`, a stop/start while fixing permissions).
  launchd retries every 10s (`ThrottleInterval`) and every retry aborts until
  the holder releases; then it comes up within ~10s. The 10s-spaced aborts pile
  up in the err log, `launchctl print` shows `runs` climbing and
  `last exit code = 1` — that is the "not working *again*" signature.
  **Restarting while a holder is active cannot help**, it only feeds the loop.

Usual holders: the screen lock / login window (each lock enables it while the
lock UI is up), 1Password, Arc or any browser with a focused password field,
`sudo` and other auth dialogs.

Checks:

- Secure input now:
  `/usr/bin/python3 -c 'import ctypes;print(bool(ctypes.CDLL("/System/Library/Frameworks/Carbon.framework/Carbon").IsSecureEventInputEnabled()))'`
  — `ioreg` does not expose this, don't bother with it.
- Who blocked the last start: `tail -1 /tmp/skhd_$(whoami).err.log` names the
  pid and app.
- Daemon state: `launchctl list | grep skhd` (PID in column 1 = alive) and
  `launchctl print gui/$UID/com.koekeishiya.skhd | grep -E 'state|runs|pid|last exit'`.

### When it stays on: a leaked Secure Keyboard Entry

Secure input is a **per-app reference count**: an app calls
`EnableSecureEventInput()` while a password field has focus and is supposed to
call `DisableSecureEventInput()` when focus moves on. Apps leak that count —
Firefox shipped exactly this bug (Mozilla 2050794: submitting a password form,
or closing a popup/window that held one) — and per Apple's TN2150 *one* leaked
count mutes every event tap, HID seize and `GetKeys` in the session for as long
as the owning process lives, focused or not.

What that means for this hotkey:

- **Nothing outside the owning process can clear it.**
  `CGSSetSecureEventInput` (what loginwindow uses) is refused for unprivileged
  processes — verified: it returns `0x10000003` — and enable/disable from
  another process only touches that process's own reference count.
- The pid macOS reports (`kCGSSessionSecureInputPID` — what the err log and
  `doctor.sh` print) is only the **frontmost app**, not the leaker. Verified by
  switching apps while stuck: 1584 Arc → 1590 WezTerm → 1620 Finder. Don't
  chase that pid.
- Fixes, cheapest first: deactivate/quit the candidate app (browsers leak it
  most; Arc restores its tabs), then log out/in. The hotkey needs no restart —
  the tap resumes the moment the count reaches zero.
- `wezterm/skhd/watch-secure-input.sh` logs every transition with the frontmost
  app, each terminal's foreground process (a waiting password prompt shows up
  there) and the newest pids, so the next leak names its culprit.
- While it is stuck, ⌘Tab / the Dock still work — only event-tap hotkeys are
  muted by design.

### Other failure modes

- Daemon alive, secure input off, key still dead: the event tap is wedged or
  Accessibility was revoked while it ran → `doctor.sh --fix`. If the err log
  says `must be run with accessibility access`, re-grant skhd in System
  Settings → Privacy & Security → Accessibility.
- `install.sh` sets the job's `KeepAlive` to `true`. The stock template's
  `KeepAlive.Crashed` only restarts skhd on a *non-zero* exit, but skhd's
  "abort" paths mix `exit(0)` (e.g. the Accessibility check) with `exit(1)`
  (secure input), so a clean-exit abort used to strand the hotkey until the
  next login.
- `install.sh` waits for Secure Keyboard Entry to clear before restarting the
  service, and otherwise skips the restart with a warning — restarting into a
  holder is what creates the abort loop above.
- `install.sh` strips `Nice -20` from the service plist: skhd's
  `--install-service` template pins the daemon at the highest scheduler
  priority on the machine, which can freeze the system if skhd spins after
  losing its CGEventTap (e.g. Accessibility revoked while running). A hotkey
  daemon doesn't need elevated priority, so the installer removes it.
- If toggling skhd's Accessibility permission while it's running hangs the
  machine, stop the service first (`skhd --stop-service`), then toggle, then
  `skhd --start-service` — revoking the event tap mid-flight is what spins.
- ⌥space is swallowed globally, so it won't reach other apps. Rebind here if
  that annoys.
