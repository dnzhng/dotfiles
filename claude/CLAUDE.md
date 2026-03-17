# Artifacts

When working on files (e.g., review documents, data files), check `~/.claude/artifacts/` first.

# Exploring Files

Do NOT format or lint files when exploring or reading them. Only format/lint files you are actively modifying as part of the current task.

# Code Style

- Use ES modules (import/export), not CommonJS (require)
- Destructure imports when possible (e.g., `import { foo } from 'bar'`)

# Git

- Only if a Jira ticket ID exists in the branch name or was provided by the user, prefix commit messages with `[Jiraticket][FOX]` (e.g., `[CXP-203313][FOX] Fix bug in component`). Otherwise, just write the commit message normally.
- When creating branches, prefix with `dnzhng/` (e.g., `dnzhng/CXP-203313/short-description`)

# GitHub

Prefer using the GitHub CLI (`gh`) for all GitHub interactions (PRs, issues, repos, etc.) over the web API or other methods.
- Always create PRs in draft mode (`--draft` flag)
- If a Jira ticket ID exists in the branch name or was provided by the user, prefix PR titles with `[Jiraticket][FOX]` (e.g., `[CXP-203313][FOX] Fix bug in component`)
- Add `[Jiraticket]` (e.g., `[CXP-203313]`) as the first line of the PR description body, extracted from the branch name

# Plans

When creating implementation plans (plan mode), always include a **Multi-Agent Team Structure** section that defines how to coordinate a team of specialized agents. The team should follow this phased structure:

### Plan Design Phase (before implementation)
- A **primary planning agent** coordinates the overall planning process
- Launch **3 subagents in parallel**, each independently designing their own full implementation plan for the task
- Each subagent receives the same context (exploration results, requirements, constraints) but works independently — no communication between them
- The primary agent then reviews all 3 proposed plans and **amalgamates them** — taking the best ideas, strongest patterns, and most robust approaches from each to form the final plan
- The final plan should note which ideas came from which proposal when relevant, and explain why certain approaches were chosen over alternatives

### Phase 1: Implementation Agents (parallel, worktree-isolated)
- Split the work into logical chunks that can run independently
- Each agent gets a `general-purpose` subagent type with `isolation: "worktree"`
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
1. Primary agent amalgamates the best parts into the final plan
2. Launch implementation agents in parallel (isolated worktrees)
3. Merge worktree changes back, resolve conflicts
4. Launch quality agents in parallel
5. Fix any issues found
6. Run code-simplifier for final cleanup
7. Run verification commands (tests, lint, typecheck)
```

Adapt the number of implementation agents and quality agents to the task size — small tasks may only need 1 implementation agent + review + simplify, while large refactors may need 3-4 implementation agents + the full quality suite.

# Settings

After modifying `~/dotfiles/claude/settings.base.json`, run:
```
~/dotfiles/claude/install.sh
```
