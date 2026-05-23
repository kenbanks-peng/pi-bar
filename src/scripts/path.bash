#!/usr/bin/env bash

set -u

MIN_SEGMENT_WIDTH=${MIN_SEGMENT_WIDTH:-10}

pad_value() {
  local value=${1:-}
  if [[ -z "$value" ]]; then
    return 0
  fi

  # Strip ANSI escapes for length calculation.
  local visible
  visible=$(printf '%b' "$value" | sed -E $'s/\x1B\[[0-9;]*m//g')
  local len=${#visible}

  if (( len < MIN_SEGMENT_WIDTH )); then
    local total=$(( MIN_SEGMENT_WIDTH - len ))
    local left=$(( total / 2 ))
    local right=$(( total - left ))
    printf '%*s%b%*s\n' "$left" '' "$value" "$right" ''
  else
    printf '%b\n' "$value"
  fi
}

folder_symbol=" "
max_length=20
current_path="$PWD"

dir_specials=(
  "$HOME/.local"   ""  "LOCAL"
  "$HOME/.cache"   ""  "CACHE"
  "$HOME/.config"  "��"  "CONFIG"
  "$HOME"          ""  "HOME"
)

matched_icon=""
matched_label=""
matched=false
DIRPATH=""

for (( i=0; i<${#dir_specials[@]}; i+=3 )); do
  if [[ "$current_path" == "${dir_specials[$i]}"* ]]; then
    matched_icon=${dir_specials[$((i + 1))]}
    matched_label=${dir_specials[$((i + 2))]}
    current_path=${current_path#"${dir_specials[$i]}"}
    matched=true
    break
  fi
done

if [[ $matched == true && -z "$current_path" ]]; then
  DIRPATH=$(pad_value "$matched_icon $matched_label")
  echo "$DIRPATH"
  exit 0
fi

trimmed_info=$(printf '%s\n' "$current_path" | awk -v max_len="$max_length" '
  {
    prepend=".."
    append="..."

    truncated = 0
    n = split($0, parts, "/")
    path = parts[n]

    if (length(path) > max_len) {
      truncated = 1
      path = substr(path, 1, max_len - length(append)) append
    } else {
      for (i = n-1; i > 0; i--) {
        if (length(parts[i] "/" path) <= max_len) {
          path = parts[i] "/" path
        } else {
          path = prepend path
          break
        }
      }
    }
    print truncated ":" path
  }')

truncated=${trimmed_info%%:*}
dirpath=${trimmed_info#*:}

if [[ $truncated == 1 ]]; then
  DIRPATH=$(pad_value "$dirpath")
elif [[ $matched == true ]]; then
  DIRPATH=$(pad_value "$matched_icon$dirpath")
else
  DIRPATH=$(pad_value "$folder_symbol$dirpath")
fi

if [[ -n "$DIRPATH" ]]; then
  echo "$DIRPATH"
fi
