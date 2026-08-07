-- Toggle WezTerm visibility (iTerm2-style "Toggle All Windows").
--   not running        -> launch
--   frontmost          -> hide (like Cmd+H)
--   running, not front -> unhide + activate
--
-- Invoked by skhd (see skhd/skhdrc) via osascript on this source file
-- (symlinked to ~/.config/wezterm by install.sh) — edits take effect on the
-- next hotkey press; no compile step.
--
-- Detection is shell-based (pgrep / lsappinfo) because System Events queries
-- cost ~100-260ms per press; System Events is only used for the hide path.

set bundleId to "com.github.wez.wezterm"

set isRunning to (do shell script "pgrep -x wezterm-gui >/dev/null 2>&1 && echo 1 || echo 0") is "1"

if not isRunning then
	tell application "WezTerm" to activate
	return
end if

-- Bundle ID of the frontmost app, e.g. "bundleid"="com.github.wez.wezterm"
-- (empty if the front app has no bundle ID).
set frontInfo to do shell script "lsappinfo info -only bundleid \"$(lsappinfo front)\" 2>/dev/null"

if frontInfo contains bundleId then
	tell application "System Events" to set visible of process "wezterm-gui" to false
else
	-- activate un-hides and brings the window forward; no System Events needed
	tell application "WezTerm" to activate
end if
