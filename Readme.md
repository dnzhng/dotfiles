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
| [ai/shared](ai/shared/) | Portable AGENTS.md distributed to Claude Code, opencode, pi, gemini | — |
