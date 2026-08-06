# lazygit

Config lives in `lazygit/config.yml` and is symlinked to
`~/Library/Application Support/lazygit/config.yml` on macOS (or
`$XDG_CONFIG_HOME/lazygit/config.yml` elsewhere).

```
$ lazygit/install.sh
```

Requires `lazygit` and `delta` (`brew install lazygit git-delta`) — the
installer checks for both and exits with a hint if either is missing. It's
idempotent and backs up any existing config to `config.yml.bak`.

Diffs are rendered with [delta] via `git.diffRenderers`
(`delta --dark --paging=never`). `diffRenderers` is an array, so additional
renderers can be added and cycled in lazygit with the `|` key — see the
[custom diff renderers docs].

[delta]: https://github.com/dandavison/delta
[custom diff renderers docs]: https://github.com/jesseduffield/lazygit/blob/master/docs/Custom_DiffRenderers.md
