#!/bin/bash
input=$(cat)
abbreviated_pwd=$(echo "$input" | jq -r '.workspace.current_dir' | xargs basename)
current_dir=$(echo "$input" | jq -r '.workspace.current_dir')
branch=$(cd "$current_dir" 2>/dev/null && git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

# Parse transcript for current tool activity
transcript_path=$(echo "$input" | jq -r '.transcript_path // empty')
tool_info=""
if [ -n "$transcript_path" ] && [ -f "$transcript_path" ]; then
  JQ_FILTER='
    [.[] | .message?.content // [] | if type == "array" then .[] else empty end |
      select(type == "object") |
      select(.type == "tool_use" or .type == "tool_result")] |
    reduce .[] as $block ({};
      if ($block.type == "tool_use") and ($block.name | . and (. == "Task" | not)) then
        . + {($block.id): {name: $block.name, target: (
          if ($block.name == "Read") or ($block.name == "Write") or ($block.name == "Edit") then
            ($block.input.file_path // $block.input.path // null | if . then (split("/") | last) else null end)
          elif ($block.name == "Grep") or ($block.name == "Glob") then
            ($block.input.pattern // null)
          elif ($block.name == "Bash") then
            ($block.input.command // "" | .[0:30])
          else null end
        )}}
      elif ($block.type == "tool_result") and ($block.tool_use_id | . and true) then
        del(.[$block.tool_use_id])
      else . end
    ) | to_entries | map(.value) | if length > 0 then
      map(.name + (if .target then ":" + .target else "" end)) | join(", ")
    else "" end
  '
  tool_info=$(tail -50 "$transcript_path" 2>/dev/null | jq -rs "$JQ_FILTER" 2>/dev/null)
fi

# Total tokens (cumulative)
total_input=$(echo "$input" | jq -r '.context_window.total_input_tokens // 0')
total_output=$(echo "$input" | jq -r '.context_window.total_output_tokens // 0')

# Context window info
context_size=$(echo "$input" | jq -r '.context_window.context_window_size // 0')
used_pct=$(echo "$input" | jq -r '.context_window.used_percentage // 0')

# Cost calculation
input_cost=$(echo "scale=4; $total_input * 15 / 1000000" | bc -l 2>/dev/null || echo "0")
output_cost=$(echo "scale=4; $total_output * 75 / 1000000" | bc -l 2>/dev/null || echo "0")
total_cost=$(echo "scale=2; $input_cost + $output_cost" | bc -l 2>/dev/null || echo "0")

# Format displays
if [ "$total_input" -ge 1000 ]; then input_display=$(echo "scale=1; $total_input / 1000" | bc -l)K; else input_display="$total_input"; fi
if [ "$total_output" -ge 1000 ]; then output_display=$(echo "scale=1; $total_output / 1000" | bc -l)K; else output_display="$total_output"; fi
if [ "$context_size" -ge 1000 ]; then context_display=$(echo "scale=0; $context_size / 1000" | bc -l)K; else context_display="$context_size"; fi

if [ -n "$branch" ]; then branch_display=$(printf " | \033[01;35mBranch:\033[00m %s" "$branch"); else branch_display=""; fi

# Main status line (without tools)
printf "\033[01;34m%s\033[00m%s | \033[01;33mTokens:\033[00m %s in / %s out | \033[01;32mContext:\033[00m %s%% of %s | \033[01;36mCost:\033[00m \$%s" \
  "$abbreviated_pwd" "$branch_display" "$input_display" "$output_display" "$used_pct" "$context_display" "$total_cost"

# Tool section on separate line
if [ -n "$tool_info" ]; then
  printf "\n\033[01;36m◐\033[00m %s" "$tool_info"
fi
