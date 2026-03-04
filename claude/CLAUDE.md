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

# Settings

After modifying `~/dotfiles/claude/settings.base.json`, run:
```
~/dotfiles/claude/install.sh
```
