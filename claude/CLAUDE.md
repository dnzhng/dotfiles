<!-- ══════════════════════════════════════════════════════════════════════
     TRIAL: Working Principles — behavioral-guidelines experiment
     Window: 2026-06-26 → 2026-07-10 (2 weeks)
     To REVERT: delete this whole block (through the END marker below),
                then run ~/dotfiles/claude/install.sh
     ══════════════════════════════════════════════════════════════════════ -->

# Working Principles  *(trial — decide by 2026-07-10)*

> **TRIAL — ACTION REQUIRED ON/AFTER 2026-07-10:** These guidelines are a 2-week
> experiment. Compare today's date (the session's currentDate) against **2026-07-10**.
> If it is on or after that date, STOP before other work and ask Daniel whether to
> **keep**, **revert**, or **extend** them — then act on his answer.

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
(b) executing a multi-agent plan with genuinely independent chunks. See "Parallel Work on
Carrot" and "Plans" for the how.

## Delegation & context hygiene
The context window is the constraint — the parent should receive conclusions, not the work that
produced them. **Delegate** to a subagent when answering needs reading >2–3 files, a broad
search, or a DB/log query; when work is independent/parallelizable; or when you want a fresh,
unbiased read. **Keep inline** for quick targeted edits (~1 file), tightly-coupled changes
where agents would collide, or work needing frequent back-and-forth. Use a **workflow** (not
ad-hoc subagents) for deterministic multi-stage fan-out — subagents can't spawn subagents.
Don't over-delegate; trivial tasks are cheaper inline (see "right-size the plan").
- Explore and Plan agents skip this CLAUDE.md — restate any rule they must honor in their prompt.
- Don't print whole files / large JSON into the conversation — save to a tmp file, pull only the
  critical fields.
- When compacting, preserve: files modified this session, exact identifiers (IDs, metric/branch
  names), verify/test commands, and any unfinished step.

<!-- ══════════════ END TRIAL block (delete to here to revert) ══════════════ -->

# Artifacts

When working on files (e.g., review documents, data files), check `~/.claude/artifacts/` first.

# Exploring Files

Do NOT format or lint files when exploring or reading them. Only format/lint files you are actively modifying as part of the current task.

# Code Style

- Use ES modules (import/export), not CommonJS (require)
- Destructure imports when possible (e.g., `import { foo } from 'bar'`)

# Git

- Use [conventional commits](https://www.conventionalcommits.org/en/v1.0.0/) for commit messages: `feat:`, `fix:`, `refactor:`, `test:`, `chore:`, `docs:`, `style:`, `perf:`. Add a scope when it clarifies (e.g., `fix(auth): prevent double modal open`). Keep the subject concise and lowercase.
- When creating branches, prefix with `dnzhng/` (e.g., `dnzhng/CXP-203313/short-description`)

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

# Plans

When creating implementation plans (plan mode), always include a **Multi-Agent Team Structure** section that defines how to coordinate a team of specialized agents. The team should follow this phased structure:

### Plan Design Phase (before implementation)
- A **primary planning agent** coordinates the overall planning process
- Launch **3 subagents in parallel**, each independently designing their own full implementation plan for the task
- Each subagent receives the same context (exploration results, requirements, constraints) but works independently — no communication between them
- The primary agent then reviews all 3 proposed plans and **amalgamates them** — taking the best ideas, strongest patterns, and most robust approaches from each to form the final plan
- The final plan should note which ideas came from which proposal when relevant, and explain why certain approaches were chosen over alternatives
- **Identify parallelization**: call out which chunks are genuinely independent (no file overlap, no sequential deps) and therefore warrant their own worktree. List them explicitly in the plan so the coordination flow is unambiguous.

### Phase 1: Implementation Agents (parallel)
- One agent per independent chunk. For sequential chunks, run them in order in the same worktree.
- Define clear scope per agent: which files to modify, which tests to run
- Identify dependencies between agents — if none, launch all in parallel

### Phase 2: Quality Agents (parallel, after implementation merges)
Run these review agents in parallel on the merged result:
- **code-reviewer** (`pr-review-toolkit:code-reviewer`): Style, CLAUDE.md compliance, pattern adherence
- **silent-failure-hunter** (`pr-review-toolkit:silent-failure-hunter`): Verify error handling correctness
- **pr-test-analyzer** (`pr-review-toolkit:pr-test-analyzer`): Test coverage completeness
- **formatter**: Lint/format all changed files

### Phase 3: Cleanup & Final Review (sequential, after quality pass)
- **code-simplifier** (`code-simplifier:code-simplifier`): Simplify and refine the implementation
- **staff-review** (`pr-review-toolkit:code-reviewer`): Final review of all changes as a staff+ engineer — evaluate correctness, edge cases, architectural fit, and whether the solution is production-ready

### Coordination Flow
```
0. Launch 3 planning subagents in parallel — each proposes a full plan
1. Primary agent amalgamates the best parts, identifies independent chunks & worktrees
2. Launch implementation agents in parallel
3. Merge changes back, resolve conflicts
4. Launch quality agents in parallel
5. Fix any issues found
6. Run code-simplifier for final cleanup
7. Run verification commands (tests, lint, typecheck)
```

Adapt the number of implementation agents and quality agents to the task size — small tasks may only need 1 implementation agent + review + simplify, while large refactors may need 3-4 implementation agents + the full quality suite.

### "right-size the plan" rule
For small changes (< ~50 LOC or single-file), skip the full multi-agent pipeline. Go straight to: 1 implementation agent → quality pass → simplify. Reserve the 3-subagent Plan Design Phase for genuinely ambiguous or cross-cutting work.

# Settings

After modifying `~/dotfiles/claude/settings.base.json`, run:
```
~/dotfiles/claude/install.sh
```

`install.sh` **merges** dotfiles into the live `~/.claude/settings.json` — it no longer overwrites it. Keys added at runtime (plugins enabled via `/plugin`, in-session permission approvals) are preserved, and the three permission lists (`allow`/`deny`/`ask`) are **unioned** across the existing file + dotfiles. Consequence: **removing a permission requires editing `~/.claude/settings.json` directly** — deleting it from dotfiles alone won't drop it, because the old copy survives in the live file. (To make dotfiles authoritative for permissions instead, drop the three union lines in `install.sh`.)

# Tmux

Tmux config and session persistence (tmux-resurrect + tmux-continuum via TPM) are managed in `~/dotfiles/tmux/`. To set up on a new machine — symlinks `~/.tmux.conf`, clones TPM, installs plugins — run:
```
~/dotfiles/tmux/install.sh
```
The script is idempotent; re-run it after changing the plugin list in `tmux/tmux.conf`. After a reboot, run `tmux` and continuum auto-restores the last session (snapshots saved every 15 min to `~/.local/share/tmux/resurrect/`).
