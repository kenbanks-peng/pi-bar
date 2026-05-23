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

PYTHON=""
PYTHON_ICON=""
VERSION=""
dir="$PWD"

if fd -d1 -e py . "$dir" -1 >/dev/null 2>&1; then
  PYTHON_ICON=$PYTHON
fi

while [[ "$dir" != "/" ]]; do
  if [[ -f "$dir/pyproject.toml" ]]; then
    PYTHON_ICON=$PYTHON
    VERSION=$(uv run python --version 2>&1 | tail -n1 | awk '{print $2}')
    [[ -z "$VERSION" ]] && VERSION="NONE"

    if [[ -z "${VIRTUAL_ENV:-}" ]]; then
      PYTHON_ICON="\e[31m$PYTHON"
    fi

    break
  fi

  dir=$(dirname "$dir")
done

components=()
[[ -n "$PYTHON_ICON" ]] && components+=("$PYTHON_ICON")
[[ -n "$VERSION" ]] && components+=("$VERSION")

PYTHON_SEGMENT=$(pad_value "${components[*]:-}")

if [[ -n "$PYTHON_SEGMENT" ]]; then
  echo "$PYTHON_SEGMENT"
fi
