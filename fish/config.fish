set hydro_color_pwd green
set hydro_color_git --bold red

for file in ~/Code/dotfiles/fish/.{functions*,exports*,aliases*}
  if test -r $file
    source "$file"
  end
end

