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
