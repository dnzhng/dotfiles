" Adding packages using vim 8 package manager:
" git submodule init
" git submodule add <PLUGIN_GIT_REPO> pack/plugins/<start|opt>/<plugin-name>

" Updating packages
" git submodule update --remote --merge

" Set leader commands
let mapleader = "\<Space>"
nnoremap <silent> <Leader>p :call fzf#run({
  \'down': '20%', 'sink': 'vertical botright split' })<CR>
nnoremap <silent> <Leader>w :q<CR>
nnoremap <silent> <Leader>s :w<CR>
nnoremap <silent> <Leader>l <C-W>l
nnoremap <silent> <Leader>h <C-W>h

" Show commands
set showcmd

"Set backspace prefs
set backspace=2

" Make tabs two spaces
set tabstop=2
set shiftwidth=2
set expandtab

" Syntax Highlighting
syntax on

"Set color scheme
colorscheme base16-ocean

" Mark a line at column 80
if (exists('+colorcolumn'))
  set colorcolumn=80
  highlight ColorColumn ctermbg=16
endif

" Vim-Airline settings
set laststatus=2 
let g:airline_theme='luna'

" Set Line numbers
set number
highlight LineNr ctermbg=16

" GitGutter settings
highlight clear SignColumn
highlight GitGutterAdd ctermbg=2
highlight GitGutterChange ctermbg=3
highlight GitGutterDelete ctermbg=1
highlight GitGutterChangeDelete ctermbg=3

" Swap the terminal's ANSI palette to base16-ocean while editing, then restore
" on exit. base16-ocean renders against the terminal's colors (cterm mode, no
" termguicolors), so the palette has to match the colorscheme.
"
" Uses standard OSC sequences (OSC 4 = palette, 10/11/12 = fg/bg/cursor) via
" echoraw(), so it works in any modern terminal — WezTerm, iTerm2, etc. This
" replaces the old iTerm2-only `SetProfile=Ocean` escape, which WezTerm ignores.
" Inside tmux the sequences are wrapped in DCS passthrough so they reach the
" outer terminal (needs `set -g allow-passthrough on`, which tmux.conf sets).
if !has('gui_running')
  " base16-ocean mapped into the 16 ANSI slots (matches the iTerm2 Ocean
  " profile this used to switch to).
  let s:ocean_colors =
    \ "\033]4;0;#2b303b;1;#bf616a;2;#a3be8c;3;#ebcb8b;4;#8fa1b3;5;#b48ead"
    \ . ";6;#96b5b4;7;#c0c5ce;8;#65737e;9;#bf616a;10;#a3be8c;11;#ebcb8b"
    \ . ";12;#8fa1b3;13;#b48ead;14;#96b5b4;15;#eff1f5\007"
    \ . "\033]10;#c0c5ce\007\033]11;#2b303b\007\033]12;#c0c5ce\007"
  " Reset palette + fg/bg/cursor back to the terminal's configured defaults.
  let s:reset_colors = "\033]104\007\033]110\007\033]111\007\033]112\007"

  function! s:emit_term_colors(seq) abort
    " Inside tmux, wrap in the DCS passthrough sequence so the OSC codes reach
    " the outer terminal; every embedded ESC must be doubled.
    let l:seq = a:seq
    if exists('$TMUX')
      let l:seq = "\033Ptmux;" . substitute(a:seq, "\033", "\033\033", 'g') . "\033\\"
    endif
    if exists('*echoraw')
      call echoraw(l:seq)
    else
      call writefile([l:seq], '/dev/tty', 'b')
    endif
  endfunction

  augroup term_theme_switch
    autocmd!
    autocmd VimEnter,ColorScheme * call s:emit_term_colors(s:ocean_colors)
    autocmd VimLeave * call s:emit_term_colors(s:reset_colors)
  augroup END
endif

