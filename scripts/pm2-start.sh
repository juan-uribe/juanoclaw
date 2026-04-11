#!/bin/bash
# pm2-start.sh — PM2-managed NanoClaw startup with Docker readiness check

set -euo pipefail

cd /Users/juanoserver/nanoclaw-sandbox-4898
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin"
export HOME="/Users/juanoserver"
export DOCKER_HOST="unix:///Users/juanoserver/.colima/default/docker.sock"

echo "[$(date)] Waiting for Colima/Docker..."
for i in $(seq 1 90); do
  if docker info &>/dev/null 2>&1; then
    echo "[$(date)] Docker ready (waited ~$((i * 2))s)"
    break
  fi
  if [ "$i" -eq 90 ]; then
    echo "[$(date)] Docker not ready after 180s — aborting"
    exit 1
  fi
  sleep 2
done

# Free port 3001 if occupied by a stale process
if lsof -ti:3001 &>/dev/null; then
  echo "[$(date)] Freeing port 3001..."
  lsof -ti:3001 | xargs kill -9 2>/dev/null || true
  sleep 1
fi

echo "[$(date)] Starting NanoClaw..."
exec /opt/homebrew/bin/node dist/index.js
