# bump up the max number of remembered commands from the default of 500
export HISTFILESIZE=10000
export HISTSIZE=${HISTFILESIZE}

# ignoreboth does ignoredups (1) and ignorespace (2)
# 1 only record a single entry when consecutive usages of the same command occur
# 2 ignore commands preceded by a space (useful for anything sensitive)
export HISTCONTROL=ignoreboth

# ignore certain commands, particularly those easily retyped
#   will only filter out the exact call, not those with differing arguments
export HISTIGNORE="history:ls:${HISTIGNORE}"

# display time each command was executed when viewing command history
export HISTTIMEFORMAT='%b %d %H:%M: '

# write to history immediately rather than at end of session
#   this way, opening a new tab will start with commands from all existing terms
export PROMPT_COMMAND="history -a; history -n; ${PROMPT_COMMAND}"

# append to, rather than overwrite, the history file
shopt -s histappend

# represent commands entered on multiple lines as a single line in the history
shopt -s cmdhist

alias hg="history | grep $1" # history grep
alias hc="> ~/.bash_history && history -c" # history clear [1]

# blog.sanctum.geek.nz/better-bash-history/
# github.com/dvorka/hstr

# [1] askubuntu.com/questions/191999/how-to-clear-bash-history-completely
