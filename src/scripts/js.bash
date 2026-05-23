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

DENO="┓"
TS=""
JS=""
BUN=""
SVELTE=""
REACT=""
NODE="��"

JS_TS_ICON=""
BUN_ICON=""
RUNTIME_ICON=""
VERSION=""
dir="$PWD"

if fd -d1 -e ts . "$dir" -1 >/dev/null 2>&1; then
  JS_TS_ICON=$TS
elif fd -d1 -e js . "$dir" -1 >/dev/null 2>&1; then
  JS_TS_ICON=$JS
fi

while [[ "$dir" != "/" ]]; do
  if [[ -f "$dir/bun.lock" || -f "$dir/bunfig.toml" ]]; then
    BUN_ICON=$BUN
  fi

  if [[ -f "$dir/deno.json" ]]; then
    RUNTIME_ICON=$DENO
    VERSION=$(deno --version 2>/dev/null | head -n1 | cut -d' ' -f2)
    break
  elif [[ -f "$dir/svelte.config.js" ]]; then
    RUNTIME_ICON=$SVELTE
    VERSION=$(jq -r '.dependencies.svelte // .devDependencies.svelte // empty' "$dir/package.json" 2>/dev/null)
    break
  elif [[ -f "$dir/package.json" ]]; then
    if rg -q "react-dom" "$dir/package.json" 2>/dev/null; then
      RUNTIME_ICON=$REACT
      VERSION=$(jq -r '.dependencies["react-dom"] // .devDependencies["react-dom"] // empty' "$dir/package.json" 2>/dev/null)
    else
      RUNTIME_ICON=$NODE
      VERSION=$(node --version 2>/dev/null | cut -c 2-)
    fi
    break
  fi

  dir=$(dirname "$dir")
done

components=()
[[ -n "$JS_TS_ICON" ]] && components+=("$JS_TS_ICON")
[[ -n "$BUN_ICON" ]] && components+=("$BUN_ICON")
[[ -n "$RUNTIME_ICON" ]] && components+=("$RUNTIME_ICON")
[[ -n "$VERSION" ]] && components+=("$VERSION")

JS_SEGMENT=$(pad_value "${components[*]:-}")

if [[ -n "$JS_SEGMENT" ]]; then
  echo "$JS_SEGMENT"
fi
