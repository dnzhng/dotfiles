# return the first existing argument or exit 1 if none exist
first_of() {
  if [ -n "$1" ]; then
    local arg=$1
    shift
    command -v $arg >> /dev/null && echo $arg || first_of "$@"
  else
    exit 1
  fi
}
