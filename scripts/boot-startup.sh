#!/bin/bash
# boot-startup.sh — NanoClaw boot startup script
# Runs at system startup via /Library/LaunchDaemons/com.nanoclaw.daemon.plist
# Executed as juanoserver (UserName key in plist), no GUI session needed.
#
# Sequence:
#   1. Start Colima (Docker VM)
#   2. Wait for Docker socket to be ready (up to 3 minutes)
#   3. Free port 3001 if occupied by a stale process
#   4. Resurrect PM2 → pm2-start.sh → NanoClaw

set -euo pipefail

export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin"
export HOME="/Users/juanoserver"
export PM2_HOME="/Users/juanoserver/.pm2"
export DOCKER_HOST="unix:///Users/juanoserver/.colima/default/docker.sock"

WORKDIR="/Users/juanoserver/nanoclaw-sandbox-4898"
LOG="$WORKDIR/logs/boot-startup.log"

mkdir -p "$WORKDIR/logs"
echo "[$(date)] ===== Boot startup initiated =====" >> "$LOG"

# 1. Start Colima
echo "[$(date)] Starting Colima..." >> "$LOG"
/opt/homebrew/bin/colima start >> "$LOG" 2>&1 || {
  echo "[$(date)] WARNING: colima start returned non-zero (may already be running)" >> "$LOG"
}

# 2. Wait for Docker to be ready (max 3 minutes)
echo "[$(date)] Waiting for Docker..." >> "$LOG"
for i in $(seq 1 90); do
  if /opt/homebrew/bin/docker info &>/dev/null 2>&1; then
    echo "[$(date)] Docker ready after ~$((i * 2))s" >> "$LOG"
    break
  fi
  if [ "$i" -eq 90 ]; then
    echo "[$(date)] ERROR: Docker not ready after 180s — aborting" >> "$LOG"
    exit 1
  fi
  sleep 2
done

# 3. Free port 3001 if occupied by a stale process
if lsof -ti:3001 &>/dev/null; then
  echo "[$(date)] Freeing port 3001..." >> "$LOG"
  lsof -ti:3001 | xargs kill -9 2>/dev/null || true
  sleep 1
fi

# 4. Resurrect PM2 (restores nanoclaw and any other saved processes)
echo "[$(date)] Resurrecting PM2..." >> "$LOG"
/opt/homebrew/bin/pm2 resurrect >> "$LOG" 2>&1
echo "[$(date)] ===== Boot startup complete =====" >> "$LOG"
