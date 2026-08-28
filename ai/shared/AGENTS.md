# Working Principles

## Think before coding
State assumptions explicitly; if uncertain, ask. If multiple interpretations exist, surface
them — don't silently pick one. Prefer the simpler approach and say so; push back when
warranted. When something's unclear, stop and name it. (Does not override the "Workflow
Shortcuts" no-confirm rule — ask only on genuine ambiguity, not routine steps.)

## Simplicity first
Minimum code that solves the problem; nothing speculative. No features beyond what was asked,
no abstractions for single-use code, no unrequested configurability, no error handling for
impossible cases. If it's 200 lines and could be 50, rewrite it. Test: "would a senior
engineer call this overcomplicated?"

## Surgical changes
Touch only what the request requires. Don't "improve" adjacent code, comments, or formatting;
don't refactor what isn't broken; match existing style even if you'd do it differently. Remove
imports/vars/functions YOUR change orphaned; leave pre-existing dead code (mention it, don't
delete). Every changed line should trace to the request. (Extends the "Exploring Files"
no-format rule.)

## Goal-driven execution
Turn tasks into verifiable goals: "fix the bug" → "write a failing test that reproduces it,
then make it pass." For multi-step work, state a brief plan with a verify check per step, then
loop until each check passes.

## Worktrees on request only
Don't spin up git worktrees for isolation in single-repo, single-agent work. Create them only
when (a) the user explicitly asks for parallel work / a worktree / a second session, or
(b) executing a multi-agent plan with genuinely independent chunks. See your parallel-work
guidance for the how.

## Delegation & context hygiene
The context window is the constraint — the parent should receive conclusions, not the work that
produced them. **Delegate** to a subagent when answering needs reading >2–3 files, a broad
search, or a DB/log query; when work is independent/parallelizable; or when you want a fresh,
unbiased read. **Keep inline** for quick targeted edits (~1 file), tightly-coupled changes
where agents would collide, or work needing frequent back-and-forth. Use a **workflow** (not
ad-hoc subagents) for deterministic multi-stage fan-out — subagents can't spawn subagents.
Don't over-delegate; trivial tasks are cheaper inline (see "right-size the plan").
- Don't print whole files / large JSON into the conversation — save to a tmp file, pull only the
  critical fields.
- When compacting, preserve: files modified this session, exact identifiers (IDs, metric/branch
  names), verify/test commands, and any unfinished step.

# Artifacts

When working on files (e.g., review documents, data files), check `~/.artifacts/` first.
(Claude Code's default is `~/.claude/artifacts/`; override in Claude-specific CLAUDE.md if
you want to keep that path.)

# Exploring Files

Do NOT format or lint files when exploring or reading them. Only format/lint files you are actively modifying as part of the current task.

# Code Style

- Use ES modules (import/export), not CommonJS (require)
- Destructure imports when possible (e.g., `import { foo } from 'bar'`)
- Keep comments minimal. Generally a single line, and only when it adds something the code doesn't already say — a non-obvious business rule, a workaround, a magic number's provenance. Avoid long comment blocks, section banners, or narrating what the next lines do. If the user explicitly asks for comments or TODO notes, that's fine.

# Git

- Use [conventional commits](https://www.conventionalcommits.org/en/v1.0.0/) for commit messages: `feat:`, `fix:`, `refactor:`, `test:`, `chore:`, `docs:`, `style:`, `perf:`. Add a scope when it clarifies (e.g., `fix(auth): prevent double modal open`). Keep the subject concise and lowercase.
- Don't reference other PRs by number in commit messages (e.g., "follow-up to #1234", "reverts parts of #5678"). Cross-PR context belongs in the PR description, not the commit — PR numbers rot as history is rewritten or repos migrate.
- When creating branches, prefix with `dnzhng/` (e.g., `dnzhng/PROJ-1234/short-description`)

# GitHub

Prefer using the GitHub CLI (`gh`) for all GitHub interactions (PRs, issues, repos, etc.) over the web API or other methods.
- Always create PRs in draft mode (`--draft` flag)

### PR quality guidelines

**Titles** — describe the *outcome*, not the mechanics. Name the product area. The diff shows *how*; the title should say *what changed in the world*.
- Good: `Signup modal defaults to login for returning visitors`
- Bad: `Add cookie check and conditional path`

**Description** — write for the reviewer, not for the record. Prove you did the work:
- **Where to start**: tell the reviewer which file to read first. "Start in `payments/charge.ts`, the rest is plumbing."
- **Why it's safe**: state it explicitly. "Safe to ship: gated behind feature flag X" or "backward-compatible migration."
- **Testing evidence**: "the tests pass" is necessary, not sufficient. Include screenshots, logs, cURL output, or query results when applicable.
- **Implications**: if you considered alternatives, say so briefly. If a change is irreversible (migrations, deletes, public API changes), call it out loudly.
- **Follow-up**: if this is a best guess you'll refine, say so. Convince the reviewer you'll iterate, not land code and disappear.
- **Scannable formatting**: use bullets, headings, and tables. Walls of prose get skipped. Hyperlink with descriptions, never paste raw URLs.

# Tmux

Tmux config and session persistence (tmux-resurrect + tmux-continuum via TPM) are managed in `~/dotfiles/tmux/`. To set up on a new machine — symlinks `~/.tmux.conf`, clones TPM, installs plugins — run:
```
~/dotfiles/tmux/install.sh
```
The script is idempotent; re-run it after changing the plugin list in `tmux/tmux.conf`. After a reboot, run `tmux` and continuum auto-restores the last session (snapshots saved every 15 min to `~/.local/share/tmux/resurrect/`).
