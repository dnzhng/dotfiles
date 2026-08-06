#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VIM_DIR="$HOME/.vim"
TARGET="$VIM_DIR/vimrc"
DESIRED="$SCRIPT_DIR/vimrc"
PACK_DIR="$VIM_DIR/pack/plugins/start"

# Plugins installed as native Vim 8 packages ("name url" per line). Cloned into
# ~/.vim/pack/plugins/start/ at install time rather than vendored in this repo —
# same approach as tmux/TPM: config is tracked here, plugins are fetched.
PLUGINS=(
    "base16-vim https://github.com/chriskempson/base16-vim.git"
    "vim-fugitive https://github.com/tpope/vim-fugitive.git"
    "vim-airline https://github.com/vim-airline/vim-airline.git"
    "vim-airline-themes https://github.com/vim-airline/vim-airline-themes.git"
    "fzf https://github.com/junegunn/fzf.git"
    "fzf.vim https://github.com/junegunn/fzf.vim.git"
    "vim-gitgutter https://github.com/airblade/vim-gitgutter.git"
    "ag.vim https://github.com/rking/ag.vim.git"
    "vim-slim https://github.com/slim-template/vim-slim.git"
)

# Require git + vim
for tool in git vim; do
    if ! command -v "$tool" &> /dev/null; then
        echo "Error: $tool is required but not installed. Install it with:"
        echo "  brew install $tool   # macOS"
        echo "  apt install $tool    # Ubuntu/Debian"
        exit 1
    fi
done

# Symlink ~/.vim/vimrc -> dotfiles vimrc (Vim's fallback for ~/.vimrc)
echo "Symlinking vimrc..."
mkdir -p "$VIM_DIR"
if [ -L "$TARGET" ] && [ "$(readlink "$TARGET")" = "$DESIRED" ]; then
    echo "  Already linked"
else
    if [ -e "$TARGET" ] || [ -L "$TARGET" ]; then
        echo "  Existing $TARGET found; backing up to $TARGET.bak"
        mv "$TARGET" "$TARGET.bak"
    fi
    ln -s "$DESIRED" "$TARGET"
    echo "  Linked $TARGET -> $DESIRED"
fi

# Clone plugins as native packages (idempotent: skip if already present)
echo "Installing Vim plugins..."
mkdir -p "$PACK_DIR"
for entry in "${PLUGINS[@]}"; do
    name="${entry%% *}"
    url="${entry#* }"
    dest="$PACK_DIR/$name"
    if [ -d "$dest" ]; then
        echo "  $name already present"
    else
        git clone --depth 1 "$url" "$dest"
        echo "  Cloned $name"
    fi
done

# Generate :help tags for the freshly cloned plugins (best-effort)
echo "Generating help tags..."
vim -es -c 'silent! helptags ALL' -c 'qa!' > /dev/null 2>&1 || true

echo "Done!"
