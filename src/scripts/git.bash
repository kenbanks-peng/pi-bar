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

GIT_FETCH_INTERVAL=${GIT_FETCH_INTERVAL:-60}
GITHUB=""
GITLAB=""
BITBUCKET=""
AZURE="��"
GIT=""
BRANCH=""
UPSTREAM=""
CHANGED="��"
AHEAD=""
BEHIND=""

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  exit 0
fi

git_dir=$(git rev-parse --git-dir 2>/dev/null)
fetch_head="$git_dir/FETCH_HEAD"
stale=0
if [[ ! -f "$fetch_head" ]]; then
  stale=1
else
  now=$(date +%s)
  last_fetch=$(stat -f %m "$fetch_head" 2>/dev/null || stat -c %Y "$fetch_head" 2>/dev/null || echo "$now")
  (( now - last_fetch > GIT_FETCH_INTERVAL )) && stale=1
fi

if (( stale == 1 )); then
  touch "$fetch_head" 2>/dev/null || true
  git fetch --all --quiet >/dev/null 2>&1 &
  disown 2>/dev/null || true
fi

branch=$(git branch --show-current 2>/dev/null)
if [[ -z "$branch" ]]; then
  branch=$(git rev-parse --short HEAD 2>/dev/null)
fi
[[ ${#branch} -gt 25 ]] && branch="${branch:0:25}…"

origin_url=$(git remote get-url origin 2>/dev/null || true)
upstream_url=$(git remote get-url upstream 2>/dev/null || true)

service_icon=""
if [[ -n "$origin_url" ]]; then
  case "$origin_url" in
    *github*) service_icon=$GITHUB ;;
    *gitlab*) service_icon=$GITLAB ;;
    *bitbucket*) service_icon=$BITBUCKET ;;
    *azure*|*visualstudio*) service_icon=$AZURE ;;
    *) service_icon=$GIT ;;
  esac
fi

changed=0
porcelain=$(git status --porcelain 2>/dev/null)
[[ -n "$porcelain" ]] && changed=1

origin_ahead=0
origin_behind=0
origin_ab=$(git rev-list --count --left-right "origin/${branch}...HEAD" 2>/dev/null || true)
if [[ -n "$origin_ab" ]]; then
  origin_behind=${origin_ab%%$'\t'*}
  origin_ahead=${origin_ab##*$'\t'}
fi

upstream_ahead=0
upstream_behind=0
if [[ -n "$upstream_url" ]]; then
  upstream_ab=$(git rev-list --count --left-right "upstream/${branch}...HEAD" 2>/dev/null || true)
  if [[ -n "$upstream_ab" ]]; then
    upstream_behind=${upstream_ab%%$'\t'*}
    upstream_ahead=${upstream_ab##*$'\t'}
  fi
fi

result="${service_icon} ${BRANCH}${branch}"
if (( changed == 1 )); then
  result+=" ${CHANGED}"
fi
if (( origin_ahead > 0 )); then
  result+=" ${AHEAD}${origin_ahead}"
fi
if (( origin_behind > 0 )); then
  result+=" ${BEHIND}${origin_behind}"
fi
if (( upstream_ahead + upstream_behind > 0 )); then
  result+=" ${UPSTREAM}"
  (( upstream_ahead > 0 )) && result+=" ${AHEAD}${upstream_ahead}"
  (( upstream_behind > 0 )) && result+=" ${BEHIND}${upstream_behind}"
fi

GITSTATUS=$(pad_value "$result")

if [[ -n "$GITSTATUS" ]]; then
  echo "$GITSTATUS"
fi
