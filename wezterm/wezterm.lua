-- WezTerm configuration — shared across macOS / Linux / Windows.
-- Docs: https://wezfurlong.org/wezterm/config/files.html
-- Symlinked to ~/.config/wezterm/wezterm.lua by wezterm/install.sh.
-- WezTerm auto-reloads this file on save.
--
-- Appearance ported from iTerm2's "Default" profile: Monaco 12, ~25% window
-- transparency, steady block cursor, and its colors. iTerm2 had "Use Separate
-- Colors for Light and Dark Mode" OFF, so it rendered one fixed dark palette
-- regardless of the macOS appearance — this config does the same (static, not
-- appearance-aware), so it stays dark even when macOS is in Light mode.

local wezterm = require 'wezterm'
local config = wezterm.config_builder()

-- Font (was Monaco 12, matching iTerm2). JetBrains Mono ships real
-- bold/italic faces and is bundled with WezTerm.
config.font = wezterm.font 'JetBrains Mono'
config.font_size = 12.5

-- Window transparency (iTerm2 transparency 0.25 -> 0.75 opacity).
-- Blur is intentionally left off to match iTerm2 (add
-- `config.macos_window_background_blur = 20` for a frosted look).
config.window_background_opacity = 0.75

-- Cursor: steady block, matching iTerm2 (blink off).
config.default_cursor_style = 'SteadyBlock'

-- Colors — iTerm2's default palette on a black background (the single,
-- non-appearance-aware color set it actually used). Bump `background` to
-- '#15191f' if you'd prefer a softer near-black.
config.colors = {
  background = '#000000',
  foreground = '#bbbbbb',
  cursor_bg = '#bbbbbb',
  cursor_fg = '#ffffff',
  cursor_border = '#bbbbbb',
  selection_bg = '#b5d5ff',
  selection_fg = '#000000',
  ansi = {
    '#000000', '#bb0000', '#00bb00', '#bbbb00',
    '#8094f4', '#bb00bb', '#00bbbb', '#bbbbbb',
  },
  brights = {
    '#555555', '#ff5555', '#55ff55', '#ffff55',
    '#95a5f2', '#ff55ff', '#55ffff', '#ffffff',
  },
}

-- Scrollback (functional, invisible)
config.scrollback_lines = 10000

-- CTRL+SHIFT+E prompts to rename the current tab (or from a shell:
-- `wezterm cli set-tab-title "name"`).
config.keys = {
  {
    key = 'E',
    mods = 'CTRL|SHIFT',
    action = wezterm.action.PromptInputLine {
      description = 'Enter new name for tab',
      action = wezterm.action_callback(function(window, pane, line)
        if line then
          window:active_tab():set_title(line)
        end
      end),
    },
  },
}

return config
