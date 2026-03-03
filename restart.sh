#!/bin/bash
# restart.sh — Rebuild and restart the NanoClaw background service
# Run from your interactive terminal (needs NVM in PATH for tsc)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.nanoclaw.plist"

# Load NVM if available (launchd strips shell PATH)
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

build() {
  local dir="$1"
  local label="$2"
  echo "[$label] Building..."
  cd "$dir"
  if command -v tsc >/dev/null 2>&1; then
    tsc
  elif command -v npx >/dev/null 2>&1; then
    npx tsc
  else
    echo "  [!] tsc not found — skipping build for $label"
    echo "      Run 'npm run build' manually in: $dir"
    return 0
  fi
}

echo "=== NanoClaw Restart ==="

build "$SCRIPT_DIR"                              "1/3 Host app"
build "$SCRIPT_DIR/container/agent-runner"       "2/3 Agent-runner"

echo "[3/4] Rebuilding agent image..."
cd "$SCRIPT_DIR/container"
if command -v docker >/dev/null 2>&1; then
  docker build -t nanoclaw-agent:latest .
else
  echo "  [!] Docker not found, skipping image build"
fi

echo "[4/4] Restarting launchd service..."
# Try modern kickstart first if service is already loaded
USER_ID=$(id -u)
if launchctl list com.nanoclaw >/dev/null 2>&1; then
  echo "  Force-restarting com.nanoclaw..."
  # -k: kill existing, -p: print pid
  launchctl kickstart -kp "gui/$USER_ID/com.nanoclaw" 2>/dev/null || \
  pkill -f "node /Volumes/DevDisk/nanoclaw/dist/index.js"
else
  echo "  Loading com.nanoclaw for the first time..."
  launchctl load "$PLIST"
fi

echo "=== Done! NanoClaw restarted ==="
