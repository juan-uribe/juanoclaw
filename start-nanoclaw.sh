#!/bin/bash
# start-nanoclaw.sh — Start NanoClaw without systemd
# To stop: kill \$(cat /Users/juanoserver/nanoclaw-sandbox-4898/nanoclaw.pid)

set -euo pipefail

cd "/Users/juanoserver/nanoclaw-sandbox-4898"

# Stop existing instance if running
if [ -f "/Users/juanoserver/nanoclaw-sandbox-4898/nanoclaw.pid" ]; then
  OLD_PID=$(cat "/Users/juanoserver/nanoclaw-sandbox-4898/nanoclaw.pid" 2>/dev/null || echo "")
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "Stopping existing NanoClaw (PID $OLD_PID)..."
    kill "$OLD_PID" 2>/dev/null || true
    sleep 2
  fi
fi

echo "Starting NanoClaw..."
nohup "/usr/bin/node" "/Users/juanoserver/nanoclaw-sandbox-4898/dist/index.js" \
  >> "/Users/juanoserver/nanoclaw-sandbox-4898/logs/nanoclaw.log" \
  2>> "/Users/juanoserver/nanoclaw-sandbox-4898/logs/nanoclaw.error.log" &

echo $! > "/Users/juanoserver/nanoclaw-sandbox-4898/nanoclaw.pid"
echo "NanoClaw started (PID $!)"
echo "Logs: tail -f /Users/juanoserver/nanoclaw-sandbox-4898/logs/nanoclaw.log"
