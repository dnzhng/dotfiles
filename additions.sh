DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )" # [1]

source "${DIR}/helpers.sh"
for addition in `ls $DIR/additions.d/*.sh`; do
  source $addition
done

# github.com/jqr/dotfiles

# [1] stackoverflow.com/questions/59895/can-a-bash-script-tell-what-directory-its-stored-in
