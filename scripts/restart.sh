#!/bin/bash
# Restart NanoClaw - spawned as a detached child by the IPC restart_service handler.
# Arguments are passed by the Node.js process to avoid hardcoded paths.
#   $1 = node binary (process.execPath)
#   $2 = main script (dist/index.js absolute path)
#   $3 = stdout log file
#   $4 = stderr log file

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

# Give the IPC handler time to finish before the process is killed
sleep 3

# Prefer pm2 restart (keeps process managed); fall back to direct nohup
if command -v pm2 &>/dev/null && pm2 describe nanoclaw &>/dev/null 2>&1; then
  pm2 restart nanoclaw
else
  NODE_BIN="$1"
  LOG_FILE="$3"
  ERR_FILE="$4"
  pkill -f "dist/index.js" 2>/dev/null || true
  sleep 1
  nohup "$NODE_BIN" "$(dirname "$2")/$(basename "$2")" >> "$LOG_FILE" 2>> "$ERR_FILE" &
fi
