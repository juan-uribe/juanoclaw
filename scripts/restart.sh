#!/bin/bash
# Restart NanoClaw - spawned as a detached child by the IPC restart_service handler.
# Arguments are passed by the Node.js process to avoid hardcoded paths.
#   $1 = node binary (process.execPath)
#   $2 = main script (dist/index.js absolute path)
#   $3 = stdout log file
#   $4 = stderr log file

NODE_BIN="$1"
SCRIPT_PATH="$2"
LOG_FILE="$3"
ERR_FILE="$4"

# Give the IPC handler time to finish before killing the parent process
sleep 3
pkill -f "dist/index.js" 2>/dev/null || true
sleep 1
nohup "$NODE_BIN" "$SCRIPT_PATH" >> "$LOG_FILE" 2>> "$ERR_FILE" &
