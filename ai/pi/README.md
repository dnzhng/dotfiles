# pi

pi (coding agent) settings. `~/.pi/agent/AGENTS.md` itself is managed by
`../shared/install.sh` — this folder holds pi-specific extras.

## Themes

`themes/base16-ocean-dark.json` — pi TUI theme built from the same base16-ocean
palette as `vim/vimrc` (`colorscheme base16-ocean`, ANSI slots in the OSC block).
Text ramp follows base16: `dim`=base04 (tertiary), `muted`=base04 (secondary),
`text`=base05 — pi's default footer renders almost entirely in `dim`, so these
tokens control its legibility. (`dim` was briefly base03, but 2.7:1 contrast is
too weak for the footer; vim reserves base03 for comments only.)

## Extensions

`extensions/box-editor.ts` — restyles the input editor as a borderless dark
panel instead of the default two horizontal rules. Subclasses `CustomEditor`
and post-processes `super.render()`, so cursor/scroll/autocomplete/wrapping
behave identically. Every line is filled with `EDITOR_BG` (default `#1c222b`,
well below the pane's `base00`; re-applied after embedded SGR resets so the
fake cursor doesn't punch holes in it), and the top/bottom border lines
become blank padding rows — no frame glyphs. A half-block ▌ accent bar runs
down the left of every row (padding included), colored with the editor's
borderColor — quiet at rest, thinking-level/bash colors when active. When the
autocomplete menu opens, the input's bottom border becomes a horizontal rule
separating input from menu options, and the bar continues through the menu.
Scroll-indicator borders keep only their "↑ N more" text. Layout knobs at the top of the file: `OUTER_MARGIN`
(blank cols each side, default 2), `INNER_PAD` (cols between panel edge and
text, default 1), `EDITOR_BG`.

The same file also insets pi's built-in footer by `OUTER_MARGIN` (idempotent
`FooterComponent.prototype.render` patch, same mechanism as max-width.ts) so
the footer's left/right edges land on the panel edges instead of the screen
edges — one continuous bottom dock.

`extensions/splash.ts` — centered startup header via the public
`ctx.ui.setHeader()` API: a two-column block of equal-width columns with a
thin │ divider — the block-letter pi logo in the theme accent color above
session info (version / model / branch / cwd), both centered within the left
column, loaded resources (context / skills / prompts / extensions / themes)
on the right, the left column vertically centered against the taller sections
list. Resources are gathered from
`~/.pi/agent` + `settings.json`
(pi doesn't expose its resourceLoader to extensions); themes via
`ctx.ui.getAllThemes()`. Stacks to one column on narrow terminals. Vertically
centers within the estimated viewport (terminal minus dock), so the
end-following scroll view never clips the logo. Applied on startup, new, and
reload; skipped on resume/fork. Pairs with `"quietStartup": true` in
settings.base.json, which hides pi's built-in resources list so it isn't
duplicated below the splash.

`extensions/max-width.ts` — caps the chat transcript to a left-justified
column (`MAX_WIDTH`, default 95) while editor and footer stay full-width, in
both regular and fullscreen (`tuiMode`) modes. pi has no native
max-content-width, so this is a private-API monkey-patch on two prototypes
(on the prototype because extensions only see the renderer through a proxy):
regular mode wraps `TuiBase.render`, where the transcript container mounts as
the first TUI child; fullscreen's layout engine sizes the transcript viewport
via `ScrollView.getContentWidth`, so the primary scroll view's content width
is capped instead (scrollbar stays at the terminal's right edge). Any
structural surprise in regular mode falls back to stock full-width rendering.
Idempotent, re-applies on `/reload`.

`extensions/mcp/` — connects pi to MCP servers, reading
`~/.pi/agent/mcp-servers.json` at runtime (a symlink to the canonical
dotfiles MCP store, created by the store's install.sh; `$PI_MCP_SERVERS`
overrides the path). The extension itself carries no machine-specific paths.
`{{MCP_USHER_PORT}}` resolution and project-key cwd matching mirror the
store's install.sh; config is re-read on every `session_start`, so `/reload`
picks up edits. MCP tools
register as `mcp__<server>__<tool>` but stay INACTIVE — the always-active
`mcp_search` tool finds and enables matches mid-turn via pi's dynamic tool
loading, so the full catalog (~100 tools across glean, atlassian,
google-workspace, wittycart, playwright) never bloats the context.
Connections are session-scoped: background connect on `session_start`
(startup never blocks on usher/VPN), close on `session_shutdown`, one
transparent reconnect on a failed call. `/mcp` posts a TUI-only status table
(not sent to the LLM); `/mcp reconnect [server]` retries. Requires
`npm install` in the directory once (`@modelcontextprotocol/sdk`;
`node_modules/` is gitignored). Known server-side limitation, same as
claude: `figma-desktop` hangs unless the Figma desktop app is running.

`extensions/quit.ts` — type `quit` (no slash) to exit pi, matching other agent
harnesses. Intercepts the exact input "quit" from the interactive editor and
calls `ctx.shutdown()` (the same graceful path as `/quit`, so cleanup hooks
fire). Exact match only — "Quit", "quit please", and RPC/scripted input all
pass through to the LLM.

`extensions/ocean-terminal.ts` — swaps the terminal palette to base16-ocean for
the duration of a pi session, porting the VimEnter/VimLeave OSC block from
`vim/vimrc` (pi themes can't set the app background, so true immersion requires
the terminal itself to switch). Applies all 16 ANSI slots + fg/bg/cursor on
`session_start`; restores terminal defaults on `session_shutdown` with reason
`quit` only, so `/new`, `/resume`, `/fork`, `/reload` don't flash the old
palette. Inside tmux it uses DCS passthrough (needs `allow-passthrough on`,
tmux.conf sets it).

Everything it does is scoped per-pane when tmux is present, so colors never
bleed into sibling panes/windows (WezTerm's `window_background_opacity` only
applies to default-background cells, so the explicit per-pane fills below are
also what makes pi opaque):

- **Inside tmux** (the common case): sets `window-style bg=#2b303b,fg=#c0c5ce`
  and all 16 `pane-colours[]` slots on pi's pane (`$TMUX_PANE`) — tmux fills
  the pane with explicit colors (opaque in WezTerm) and resolves palette
  indexes to ocean RGB on the wire. Nothing terminal-wide is emitted; on
  start it also emits OSC 104/110/111/112 resets to clean up any swap leaked
  by the non-tmux path or older versions. All pane options are unset on quit.
- **Outside tmux**: terminal-wide OSC palette swap (the vimrc block) —
  colors only, no opacity automation (pi stays translucent there; the
  per-pane fill is a tmux-only trick).

Caveat: if pi is killed with SIGKILL the restores never fire (same failure
mode as vim). Reset manually with:

```bash
tmux set -pu -t "$TMUX_PANE" window-style
tmux set -pu -t "$TMUX_PANE" pane-colours
printf '\033]104\007\033]110\007\033]111\007\033]112\007'
```

`extensions/plan-mode/` — read-only exploration mode, toggled with `/plan`,
`Ctrl+Alt+P`, or the `--plan` startup flag. Enabling swaps the active tool set
to read-only (`edit`/`write` removed, other active tools kept, restored on
exit) and hooks `tool_call` to block bash outside a read-only allowlist
(utils.ts: a destructive-pattern denylist and a safe-pattern allowlist, both
must pass). While enabled, a `[PLAN MODE ACTIVE]` prompt is injected every
turn — and filtered back out of context once disabled — steering the model to
a numbered `Plan:` list with a verify check per step. On `agent_end` the steps
are extracted and a select offers Execute / Stay / Refine: Execute restores
full tools and tracks completion via `[DONE:n]` markers in assistant replies
(footer `📋 n/m` status + strikethrough widget, "Plan Complete" summary when
all steps land). State (enabled/todos/executing/pre-plan tool set) persists
via `appendEntry`, so resume restores a mid-execution plan, re-scanning only
messages after the last execute marker for `[DONE:n]` tags.

`extensions/memory.ts` — injects the cwd project's long-term memory index
(`MEMORY.md`) into the system prompt, mirroring Claude Code's per-project
auto-memory. Store: `~/.pi/agent/memory` (install.sh symlinks it to
`private/ai/shared/memory/agent`; `$PI_MEMORY_STORE` overrides). cwd →
project matching mirrors ai/claude/install.sh's slug-suffix rule (longest
name wins) plus an interior-segment fallback so graft worktrees
(`~/grafts/carrot/<slug>`) resolve to their repo; no match → nothing
injected (zero token cost). Only the index is ever injected — the global
section is already inlined by ai/claude/install.sh, and linked memory files
are read on demand — so per-session cost is the index alone. The block is
appended to the system prompt on every `before_agent_start` (stateless,
survives compaction, rides prompt caching) and re-read when MEMORY.md's
mtime changes, so memories written mid-session appear without a restart.
Subagent sessions load ambient extensions: fresh-context children get the
index for their own cwd (cross-repo recall); fork-context children inherit
the parent's system prompt instead — use fresh context when spawning a
child into another repo. `/memory` shows the current match.

## Settings

`settings.base.json` — portable preferences, merged into
`~/.pi/agent/settings.json` by install.sh (same pattern as `ai/claude`,
simpler). Keys the base defines win; machine-local keys it doesn't define
(`defaultProvider`, `defaultModel`, `enabledModels`, `lastChangelogVersion`,
`tuiMode`) are preserved; `packages` is unioned so a package installed on one
machine isn't dropped by the next install run. Deliberately NOT a symlink —
pi rewrites settings.json at runtime, which would dirty the repo and leak
machine-specific providers to machines that don't have them.

The `skills` array points pi at `~/.claude/skills` — the shared skills
installed by `ai/shared/install.sh` (lazygit, vim, ...), so pi discovers the
same skills as Claude Code and opencode with no extra symlinks. They appear
in the model's context by description, and each is also invocable as
`/skill:<name>` (`enableSkillCommands` defaults to true).

Contract: if you change a preference via `/settings` and want it on every
machine, port it into `settings.base.json`, commit, and re-run install.sh
elsewhere. Note a running pi session rewrites settings.json from in-memory
state and can clobber a fresh merge — re-run install.sh with pi closed (or
just /reload and re-check) if a key seems to vanish.

## Install

```bash
~/dotfiles/ai/pi/install.sh
```

Idempotent: symlinks each `themes/*.json` into `~/.pi/agent/themes/` (existing
non-symlink files are backed up to `.bak`). Then pick the theme via `/settings`
in pi. Edits to the active theme hot-reload — tweak the JSON and watch it change
live in the TUI.
