#!/usr/bin/env bash
set -Eeuo pipefail

label="com.asthrix.fusion-runner"
default_cloud_url="https://fusion-api.asthrix.workers.dev"
default_binary_base_url="https://openfusion.asthrix.workers.dev/downloads"

cloud_url="$default_cloud_url"
binary_base_url="$default_binary_base_url"
binary_url=""
token=""
runner_id=""
install_dir="${FUSION_RUNNER_INSTALL_DIR:-$HOME/.openfusion/bin}"
symlink_dir="${FUSION_RUNNER_SYMLINK_DIR:-$HOME/.local/bin}"
start_service=1
foreground=0
allowed_roots=()

usage() {
  cat <<'USAGE'
Usage: macos.sh [options]

Installs Fusion Runner as a macOS LaunchAgent. This hosted installer does not
require a openFusion source checkout or package.json.

Options:
  --cloud-url URL        Fusion API URL. Defaults to production.
  --binary-base-url URL  Base URL containing macOS runner binaries.
  --binary-url URL       Exact runner binary URL. Overrides --binary-base-url.
  --token TOKEN          Optional runner token.
  --runner-id ID         Stable runner ID. Defaults to user + host.
  --allowed-root DIR     Workspace root the runner may use. Repeatable.
  --install-dir DIR      Binary install directory. Defaults to ~/.openfusion/bin.
  --symlink-dir DIR      Directory for fusion-runner symlink. Defaults to ~/.local/bin.
--no-start             Install files without starting the LaunchAgent.
  --foreground           Run the runner in the foreground instead of a LaunchAgent.
  -h, --help             Show this help.
USAGE
}

read_next_arg() {
  local name="$1"
  local value="${2:-}"
  if [[ -z "$value" ]]; then
    echo "$name requires a value." >&2
    exit 2
  fi
  printf '%s' "$value"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cloud-url)
      cloud_url="$(read_next_arg "$1" "${2:-}")"
      shift 2
      ;;
    --binary-base-url)
      binary_base_url="$(read_next_arg "$1" "${2:-}")"
      shift 2
      ;;
    --binary-url)
      binary_url="$(read_next_arg "$1" "${2:-}")"
      shift 2
      ;;
    --token)
      token="$(read_next_arg "$1" "${2:-}")"
      shift 2
      ;;
    --runner-id)
      runner_id="$(read_next_arg "$1" "${2:-}")"
      shift 2
      ;;
    --allowed-root)
      allowed_roots+=("$(read_next_arg "$1" "${2:-}")")
      shift 2
      ;;
    --install-dir)
      install_dir="$(read_next_arg "$1" "${2:-}")"
      shift 2
      ;;
    --symlink-dir)
      symlink_dir="$(read_next_arg "$1" "${2:-}")"
      shift 2
      ;;
    --no-start)
      start_service=0
      shift
      ;;
    --foreground)
      foreground=1
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
  echo "This installer is for macOS." >&2
  exit 1
fi

if [[ -z "$cloud_url" ]]; then
  echo "--cloud-url cannot be empty" >&2
  exit 1
fi

case "$(uname -m)" in
  arm64|aarch64)
    binary_arch="arm64"
    ;;
  x86_64|amd64)
    binary_arch="amd64"
    ;;
  *)
    echo "Unsupported macOS architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

if [[ -z "$binary_url" ]]; then
  binary_base_url="${binary_base_url%/}"
  if [[ -z "$binary_base_url" ]]; then
    echo "--binary-base-url cannot be empty" >&2
    exit 1
  fi
  binary_url="$binary_base_url/fusion-runner-darwin-$binary_arch"
fi

binary_path="$install_dir/fusion-runner"
config_dir="$HOME/.openfusion"
log_dir="$config_dir/logs"
plist_dir="$HOME/Library/LaunchAgents"
plist_path="$plist_dir/$label.plist"

if [[ -z "$runner_id" ]]; then
  host_name="$(scutil --get LocalHostName 2>/dev/null || hostname || echo local)"
  runner_id="runner_${USER:-local}_${host_name}"
  if [[ -n "$token" ]] && command -v shasum >/dev/null 2>&1; then
    token_suffix="$(printf '%s' "$token" | shasum -a 256 | awk '{print substr($1, 1, 12)}')"
    runner_id="${runner_id}_${token_suffix}"
  fi
  runner_id="$(printf '%s' "$runner_id" | tr -cs 'A-Za-z0-9_-' '_' | sed 's/_$//')"
fi

mkdir -p "$install_dir" "$symlink_dir" "$config_dir" "$log_dir" "$plist_dir"

download_tmp="$(mktemp "$install_dir/fusion-runner.XXXXXX")"
cleanup() {
  rm -f "$download_tmp"
}
trap cleanup EXIT

echo "Downloading Fusion Runner for macOS $binary_arch..."
curl -fsSL "$binary_url" -o "$download_tmp"
download_size="$(wc -c < "$download_tmp" | tr -d '[:space:]')"
if [[ "$download_size" -lt 1048576 ]]; then
  echo "Downloaded runner binary is unexpectedly small: $download_size bytes." >&2
  exit 1
fi
install -m 0755 "$download_tmp" "$binary_path"
rm -f "$download_tmp"
trap - EXIT

xattr -d com.apple.quarantine "$binary_path" 2>/dev/null || true

ln -sf "$binary_path" "$symlink_dir/fusion-runner"

login_args=(login --cloud-url "$cloud_url")
if [[ -n "$token" ]]; then
  login_args+=(--token "$token")
fi
"$binary_path" "${login_args[@]}"
"$binary_path" config set runner-id "$runner_id"

if [[ ${#allowed_roots[@]} -eq 0 ]]; then
  default_roots=("$HOME/Projects" "$HOME/Documents")
  for root in "${default_roots[@]}"; do
    if [[ -d "$root" ]]; then
      allowed_roots+=("$root")
    fi
  done
  if [[ ${#allowed_roots[@]} -eq 0 ]]; then
    allowed_roots+=("$HOME")
  fi
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
launchctl bootout "gui/$uid/$label" >/dev/null 2>&1 || true
launchctl bootout "gui/$uid" "$plist_path" >/dev/null 2>&1 || true
launchctl remove "$label" >/dev/null 2>&1 || true

if [[ "$foreground" -eq 1 ]]; then
  cat <<SUMMARY
Fusion Runner installed (foreground mode).

Binary:  $binary_path
Command: $symlink_dir/fusion-runner
Config:  $config_dir/config.json
Logs:    $log_dir/runner.out.log
          $log_dir/runner.err.log

Runner ID: $runner_id
Cloud URL: $cloud_url

Starting in foreground. Press Ctrl+C to stop.
SUMMARY
  exec "$binary_path" serve --cloud-url "$cloud_url"
fi

if [[ "$start_service" -eq 1 ]]; then
  if launchctl bootstrap "gui/$uid" "$plist_path" 2>"$log_dir/bootstrap.err.log"; then
    launchctl enable "gui/$uid/$label" >/dev/null 2>&1 || true
    launchctl kickstart -k "gui/$uid/$label" >/dev/null 2>&1 || true
  else
    echo "LaunchAgent bootstrap failed; falling back to foreground mode." >&2
    echo "The runner will stay active in this terminal. Press Ctrl+C to stop." >&2
    echo "To use a LaunchAgent instead, remove the stale agent with:" >&2
    echo "  launchctl bootout gui/$uid/$label 2>/dev/null; rm -f \"$plist_path\"" >&2
    echo "" >&2
    exec "$binary_path" serve --cloud-url "$cloud_url"
  fi
fi

cat <<SUMMARY
Fusion Runner installed.

Binary:  $binary_path
Command: $symlink_dir/fusion-runner
Config:  $config_dir/config.json
Service: $plist_path
Logs:    $log_dir/runner.out.log
         $log_dir/runner.err.log

Runner ID: $runner_id
Cloud URL: $cloud_url

Open the openFusion Agents page and press Refresh.
SUMMARY
