<!-- managed-by:dotfiles/ai/pi -->

## Model setup

The primary model (`open-weights/glm-5.3-flash`) is the current recommended
baseline and supports both text and images — handle image reading inline with
the `read` tool like any other file. No image-routing subagent is needed.

## Optional workflow subagents

Three workflow subagents exist as context-hygiene helpers — delegating to them
is optional, not mandatory. Delegate when keeping the parent session's context
clean is worth it (large diffs, noisy test output, broad multi-file research);
handle small or in-flight-coupled cases inline.

- **commit-pr-drafter** — pure generation (`tools: ""`): pass a diff or commit
  range, get back `## Commit subject` / `## PR title` / `## PR body` text. The
  parent runs `git commit` / `gh pr create` itself. The empty tool allowlist is
  by design, not a config bug.
- **test-summarizer** — pass one exact test/lint command; it returns
  `ALL GREEN` / `FAILURES` / `BLOCKER` output with `file:line` detail.
- **repo-scout** — read-only broad research; returns `SUMMARY`/`FINDINGS`
  (path:lineRange) / `UNRESOLVED`.
- **pr-reader** — pass one PR URL/number; it fetches title/body/diff/review
  threads with `gh` and returns `WHAT CHANGED` / `PATTERN` /
  `REVIEW COMMENTS`. Use it to mine a PR for a pattern or triage review
  comments without pulling the diff into this session. Read-only: it never
  comments, merges, or closes.
- **comment-sweeper** — pass changed-file paths (plus an optional verify
  command); it deletes over-added comments (narrative restatement, change
  narration, redundant JSDoc) while keeping why-comments, gotchas, and lint
  directives. It edits files (pinned to deepseek-v4p1-flash for speed), so run
  it after a review finds comment bloat — e.g. as the plan-mode review team's
  comment-audit follow-up.

Children inherit the default model (no `model:` pins). Guardrails:
- One delegation per task; do not fan out for trivial cases.
- Before trusting a subagent's result, verify it has the expected section
  headers (`ALL GREEN`/`FAILURES`, `SUMMARY`/`FINDINGS`/`UNRESOLVED`, `##
  Commit subject`). If the shape is wrong, re-delegate once or handle inline.
