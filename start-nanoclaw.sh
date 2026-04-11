#!/bin/bash
# start-nanoclaw.sh — Start NanoClaw without systemd
# To stop: pkill -f dist/index.js

set -euo pipefail

cd "/Users/juanoserver/nanoclaw-sandbox-4898"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

# Prefer pm2 (managed, auto-restart on crash)
if command -v pm2 &>/dev/null && pm2 describe nanoclaw &>/dev/null 2>&1; then
  echo "Restarting via pm2..."
  pm2 restart nanoclaw
  pm2 list
  exit 0
fi

# Fallback: direct nohup (if pm2 not set up)
echo "Starting NanoClaw directly (pm2 not configured)..."
pkill -f "dist/index.js" 2>/dev/null && sleep 2

SCRIPT="/Users/juanoserver/nanoclaw-sandbox-4898/scripts/pm2-start.sh"
LOG="/Users/juanoserver/nanoclaw-sandbox-4898/logs/nanoclaw.log"
ERR="/Users/juanoserver/nanoclaw-sandbox-4898/logs/nanoclaw.error.log"

nohup bash "$SCRIPT" >> "$LOG" 2>> "$ERR" &
echo $! > "/Users/juanoserver/nanoclaw-sandbox-4898/nanoclaw.pid"
echo "NanoClaw started (PID $!)"
echo "Logs: tail -f $LOG"
