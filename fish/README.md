# Fish Shell

- Install fish shell
```
$ brew install fish
$ fish
$ fish_add_path /opt/homebrew/bin
$ echo "/opt/homebrew/bin/fish" | sudo tee -a /etc/shells
$ chsh -s /opt/homebrew/bin/fish
```
- source `fish/config.fish` from `~/.config/fish/config.fish`
- Add `fisher` for package manager
- Install
```
edc/bass
jorgebucaran/hydro
patricf1/fzf.fish
jorgebucaran/autopair.fish
```

## iTerm 2 specifics
- Update Normal/Blue to #8094f4
- Update Bright/Blue to #95a5f2
- Check `Smart box cursor color`
- Update the start command to `/usr/local/bin/fish` or whatever the path to fish is
