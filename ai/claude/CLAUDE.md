@AGENTS.md

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

After modifying `~/dotfiles/ai/claude/settings.base.json`, run:
```
~/dotfiles/ai/claude/install.sh
```

`install.sh` **merges** dotfiles into the live `~/.claude/settings.json` — it no longer overwrites it. Keys added at runtime (plugins enabled via `/plugin`, in-session permission approvals) are preserved, and the three permission lists (`allow`/`deny`/`ask`) are **unioned** across the existing file + dotfiles. Consequence: **removing a permission requires editing `~/.claude/settings.json` directly** — deleting it from dotfiles alone won't drop it, because the old copy survives in the live file. (To make dotfiles authoritative for permissions instead, drop the three union lines in `install.sh`.)
