export VISUAL=$(first_of "sublime -w" "mate -w" "nano -w" vim)
export EDITOR=$VISUAL

alias s="sublime"
