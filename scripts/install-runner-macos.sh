#!/usr/bin/env bash
set -Eeuo pipefail

label="com.asthrix.fusion-runner"
default_cloud_url="https://fusion-api.asthrix.workers.dev"

cloud_url="$default_cloud_url"
token=""
runner_id=""
install_dir="${FUSION_RUNNER_INSTALL_DIR:-$HOME/.fusion-harness/bin}"
start_service=1
allowed_roots=()

usage() {
  cat <<'USAGE'
Usage: scripts/install-runner-macos.sh [options]

Installs Fusion Runner as a macOS LaunchAgent. After this one-time setup, the
runner starts on login and restarts automatically if it exits.

Options:
  --cloud-url URL      Fusion API URL. Defaults to production.
  --token TOKEN        Optional runner token.
  --runner-id ID       Stable runner ID. Defaults to user + host.
  --allowed-root DIR   Workspace root the runner may use. Repeatable.
  --install-dir DIR    Binary install directory. Defaults to ~/.fusion-harness/bin.
  --no-start           Install files without starting the LaunchAgent.
  -h, --help           Show this help.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cloud-url)
      cloud_url="${2:-}"
      shift 2
      ;;
    --token)
      token="${2:-}"
      shift 2
      ;;
    --runner-id)
      runner_id="${2:-}"
      shift 2
      ;;
    --allowed-root)
      allowed_roots+=("${2:-}")
      shift 2
      ;;
    --install-dir)
      install_dir="${2:-}"
      shift 2
      ;;
    --no-start)
      start_service=0
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
  echo "This installer is for macOS. Use fusion-runner serve directly on this platform." >&2
  exit 1
fi

if [[ -z "$cloud_url" ]]; then
  echo "--cloud-url cannot be empty" >&2
  exit 1
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
runner_dir="$repo_root/apps/runner-go"
binary_path="$install_dir/fusion-runner"
config_dir="$HOME/.fusion-harness"
log_dir="$config_dir/logs"
plist_dir="$HOME/Library/LaunchAgents"
plist_path="$plist_dir/$label.plist"

if [[ -z "$runner_id" ]]; then
  host_name="$(scutil --get LocalHostName 2>/dev/null || hostname || echo local)"
  runner_id="runner_${USER:-local}_${host_name}"
  runner_id="$(printf '%s' "$runner_id" | tr -cs 'A-Za-z0-9_-' '_' | sed 's/_$//')"
fi

mkdir -p "$install_dir" "$config_dir" "$log_dir" "$plist_dir"

if command -v go >/dev/null 2>&1; then
  echo "Building Fusion Runner..."
  (cd "$runner_dir" && go build -o "$binary_path" ./cmd/fusion-runner)
elif [[ -x "$runner_dir/fusion-runner" ]]; then
  echo "Go is not installed; copying the checked-in development binary."
  install -m 0755 "$runner_dir/fusion-runner" "$binary_path"
else
  cat >&2 <<'ERROR'
Go is required to build Fusion Runner from this source checkout.
Install Go, then run this installer again.
ERROR
  exit 1
fi

chmod 0755 "$binary_path"

login_args=(login --cloud-url "$cloud_url")
if [[ -n "$token" ]]; then
  login_args+=(--token "$token")
fi
"$binary_path" "${login_args[@]}"
"$binary_path" config set runner-id "$runner_id"

if [[ ${#allowed_roots[@]} -eq 0 ]]; then
  allowed_roots+=("$repo_root")
fi

for root in "${allowed_roots[@]}"; do
  if [[ -z "$root" ]]; then
    continue
  fi
  if [[ ! -d "$root" ]]; then
    echo "Skipping missing allowed root: $root" >&2
    continue
  fi
  root="$(cd -- "$root" && pwd)"
  "$binary_path" config set allowed-root "$root"
done

xml_escape() {
  local value="$1"
  value="${value//&/&amp;}"
  value="${value//</&lt;}"
  value="${value//>/&gt;}"
  value="${value//\"/&quot;}"
  printf '%s' "$value"
}

launch_path="${PATH:-/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin}"
for dir in "$HOME/.local/bin" "$HOME/.npm-global/bin" "$HOME/.bun/bin" "$HOME/.cargo/bin" "/opt/homebrew/bin" "/usr/local/bin"; do
  case ":$launch_path:" in
    *":$dir:"*) ;;
    *) launch_path="$launch_path:$dir" ;;
  esac
done

cat > "$plist_path" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$(xml_escape "$label")</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml_escape "$binary_path")</string>
    <string>serve</string>
    <string>--cloud-url</string>
    <string>$(xml_escape "$cloud_url")</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$(xml_escape "$HOME")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$(xml_escape "$launch_path")</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$(xml_escape "$log_dir/runner.out.log")</string>
  <key>StandardErrorPath</key>
  <string>$(xml_escape "$log_dir/runner.err.log")</string>
</dict>
</plist>
PLIST

uid="$(id -u)"
launchctl bootout "gui/$uid" "$plist_path" >/dev/null 2>&1 || true

if [[ "$start_service" -eq 1 ]]; then
  launchctl bootstrap "gui/$uid" "$plist_path"
  launchctl enable "gui/$uid/$label" >/dev/null 2>&1 || true
  launchctl kickstart -k "gui/$uid/$label" >/dev/null 2>&1 || true
fi

cat <<SUMMARY
Fusion Runner installed.

Binary:  $binary_path
Config:  $config_dir/config.json
Service: $plist_path
Logs:    $log_dir/runner.out.log
         $log_dir/runner.err.log

Runner ID: $runner_id
Cloud URL: $cloud_url

Open the Fusion Harness Agents page and press Refresh.
SUMMARY
