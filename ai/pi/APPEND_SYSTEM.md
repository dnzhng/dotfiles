<!-- managed-by:dotfiles/ai/pi — Embassy-style model routing -->

## Model-routed subagents

The primary model (`open-weights-long/fireworks/glm-5p2-fast`) is text-only and priced for general work. When a task matches one of the recurring types below, you **must** delegate it to the named subagent via the `subagent` tool — do **not** handle that work inline in the parent session. Pass the delegated task as a self-contained prompt; the child runs on a pinned cheaper/appropriate model and returns a contracted result.

- **Commit / PR drafting** — when the user asks for a commit message, PR title, or PR body, or says "branch and pr" and the diff is ready, you **must** call `subagent({ agent: "commit-pr-drafter", task: <diff or commit range> })`. Do not draft commits or PR bodies inline. The drafter is pure generation (`tools: ""`) by design — it returns the `## Commit subject` / `## PR title` / `## PR body` text only; it does **not** run git or create the PR. The parent then runs `git commit` / `gh pr create` itself with the returned text. An empty/`""` tool allowlist here is correct, not a config bug.
- **Test / lint summarization** — when the user asks to run a test suite or lint and summarize failures, you **must** call `subagent({ agent: "test-summarizer", task: <exact command> })`. Do not run the command in the parent session.
- **Read-only repo scouting** — when a task is a broad "where is X defined / how does Y work across the repo" research question, you **must** call `subagent({ agent: "repo-scout", task: <question> })`. Do not do broad repo grep-and-read inline; handle only tightly-scoped single-file reads inline.
- **Image reading** — any request that requires reading or describing an image file **must** go through `subagent({ agent: "image-reader", task: <image path + specific question> })`. The primary model is text-only and cannot handle images; do not attempt image reads inline.

Guardrails:
- Only delegate when the task clearly matches one of the above. For ambiguous, in-flight-coupled, or multi-step work that needs back-and-forth, handle inline.
- The child's pinned model is automatic — do not pass `model:` in the delegation call.
- One delegation per task; do not fan out for trivial cases.
- If a delegated subagent fails because its pinned model is unavailable, surface the error to the user as a blocker. Do not retry image-reading inline (the primary model is text-only); for other types, only retry inline if the work is urgent and you tell the user you fell back.
- Before trusting a subagent's result, verify it has the expected section headers (e.g. `ANSWER`/`VISIBLE`, `SUMMARY`/`FINDINGS`/`UNRESOLVED`, `ALL GREEN`/`FAILURES`). If the shape is wrong, re-delegate once or surface a blocker — do not pass malformed output through as if it were correct.
