# shellcheck shell=bash
# Shared helpers for the infra/ scripts. Source it; do not run it.
#
# Every script prints the gcloud commands it would run and changes nothing, unless it
# is called with --apply. Read the printed commands first; then run again with --apply
# from a shell signed in as the project owner (gcloud auth login).

set -euo pipefail

APPLY=false
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=true ;;
    *) ;;
  esac
done

: "${PROJECT_ID:=uv-activity-planner}"

# Runs a command with --apply, or prints it (shell-quoted) without.
run() {
  if [ "$APPLY" = true ]; then
    "$@"
  else
    printf '%q ' "$@"
    printf '\n'
  fi
}

require() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "Set $name first, for example: $name=<value> $0" >&2
    exit 2
  fi
}
