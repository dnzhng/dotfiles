# Profile Additions

Targets Bash on Mac OS for git workflows

- Custom prompt showing login, current path, git branch, and git info
- Git command aliases

## Installation

Source additions.sh in your .bash_profile

## Per-tool setup

Each tool is self-contained in its own folder — config, install script, and
docs. Install scripts are idempotent and safe to re-run.

| Tool | Summary | Docs |
|------|---------|------|
| [fish](fish/) | Shell + fisher plugins, iTerm2 colors | [fish/README.md](fish/README.md) |
| [tmux](tmux/) | Config + TPM plugins, session persistence via resurrect/continuum | [tmux/README.md](tmux/README.md) |
| [wezterm](wezterm/) | Portable terminal config + macOS global hotkey toggle | [wezterm/README.md](wezterm/README.md) |
| [vim](vim/) | vimrc + native Vim 8 packages, base16-ocean | [vim/README.md](vim/README.md) |
| [lazygit](lazygit/) | Config with delta as the diff renderer | [lazygit/README.md](lazygit/README.md) |
| [ai/claude](ai/claude/) | Claude Code settings + CLAUDE.md, layered with private overrides | [ai/claude/README.md](ai/claude/README.md) |
| [ai/shared](ai/shared/) | Portable AGENTS.md + shared skills (AGENTS.md to Claude Code, opencode, pi, gemini; skills to ~/.claude/skills, which opencode also scans) | — |

## Syncing across machines

`sync.sh` keeps machines in step: it commits and pushes local changes in both
repos (this one and `private/`, a separate clone), pulls anything pushed from
elsewhere (`pull --rebase --autostash`), then re-runs every `install.sh` so the
machine matches the repo — including re-asserting the merged AGENTS.md over a
Gohan overwrite, with a final `cmp` verification. A rebase conflict aborts
loudly; resolve it and re-run.

Run it three ways:

- `sync.sh` directly
- `dotfiles-sync` from fish (auto-sourced from `fish/.functionsDotfiles`)
- `/sync` inside pi (extension: `ai/pi/extensions/dotfiles.ts`), which also
  warns at startup when either repo is dirty/ahead/behind or an installed
  AGENTS.md has drifted, and offers to run the sync from the prompt

Scripts and extensions locate the repo via `$DOTFILES_DIR`, falling back to the
first of `~/Code/dotfiles`, `~/dotfiles` with a `.git` — no path is hardcoded
(same pattern as `$PI_AGENT_STORE`).
