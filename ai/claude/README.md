# Claude Code

Claude Code settings and instructions, installed into `~/.claude/`:

```
$ ai/claude/install.sh
```

Requires `jq` (`brew install jq`) for the settings merge. The installer is
idempotent and never clobbers runtime state — safe to re-run after any edit
here.

## What gets installed

| Source | Destination | How |
|--------|-------------|-----|
| `ai/claude/CLAUDE.md` | `~/.claude/CLAUDE.md` | copied; private layer appended if present |
| `ai/shared/AGENTS.md` | `~/.claude/AGENTS.md` | copied via `ai/shared/install.sh`; private layer appended if present |
| `ai/claude/settings.base.json` | `~/.claude/settings.json` | **deep-merged**, never overwritten |
| `ai/claude/statusline-command.sh` | `~/.claude/statusline-command.sh` | symlinked |
| `ai/claude/agents/*.md` | `~/.claude/agents/` | symlinked |
| `ai/shared/skills/*/SKILL.md` | `~/.claude/skills/` | symlinked per skill dir via `ai/shared/install.sh` |
| `private/ai/claude/*` | `~/.claude/` | optional private layer (see below) |

Skills are symlinked one directory at a time, and a destination that already
exists and isn't a dotfiles symlink (e.g. a skill installed via `/plugin` or
dropped in manually) is skipped, never overwritten. Base skills live in
`ai/shared/skills/` so other harnesses can share them (opencode auto-loads
`~/.claude/skills/` as external skills). The private layer can add its own
skills via `private/ai/claude/skills/`.

## Settings are merged, not replaced

`settings.json` is built by deep-merging layers with jq, rightmost wins:

```
existing settings.json < settings.base.json < settings.local.json
```

The existing file stays in the stack so runtime-written keys (e.g. tool
runtimes) survive re-installs. The three `permissions` arrays
(`allow`/`deny`/`ask`) are unioned and deduped across all layers rather than
overwritten. Top-level `_`-prefixed keys are treated as annotations and
stripped from the output. The write is atomic (temp file + rename) and aborts
loudly if jq fails, leaving the existing `settings.json` untouched.

**After editing `settings.base.json`, re-run `ai/claude/install.sh`** — nothing
auto-reloads it.

## Private layer

`private/ai/claude/` (a separate, private repo) overlays machine- or
work-specific config:

- `private/ai/claude/CLAUDE.md` — appended to the installed `~/.claude/CLAUDE.md`
- `private/ai/claude/settings.local.json` — merged last, highest precedence
- `private/ai/claude/agents/*.md` — symlinked alongside base agents
- `private/ai/claude/install.sh` — runs at the end of the base install
