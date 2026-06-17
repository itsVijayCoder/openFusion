#!/usr/bin/env bash
set -Eeuo pipefail

label="com.asthrix.fusion-runner"
remove_all=0

usage() {
  cat <<'USAGE'
Usage: scripts/uninstall-runner-macos.sh [--all]

Stops and removes the Fusion Runner macOS LaunchAgent.

Options:
  --all       Also remove ~/.fusion-harness/bin/fusion-runner and logs.
  -h, --help  Show this help.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all)
      remove_all=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This uninstaller is for macOS." >&2
  exit 1
fi

plist_path="$HOME/Library/LaunchAgents/$label.plist"
uid="$(id -u)"

launchctl bootout "gui/$uid" "$plist_path" >/dev/null 2>&1 || true
rm -f "$plist_path"

if [[ "$remove_all" -eq 1 ]]; then
  rm -f "$HOME/.fusion-harness/bin/fusion-runner"
  rm -f "$HOME/.fusion-harness/logs/runner.out.log" "$HOME/.fusion-harness/logs/runner.err.log"
fi

echo "Fusion Runner LaunchAgent removed."
