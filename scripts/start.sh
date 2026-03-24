#!/bin/bash
# Ensure Colima (Docker runtime) is running before starting NanoClaw
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/Users/juanoserver/.local/bin"
export HOME="/Users/juanoserver"

# Start colima if not already running (idempotent)
if ! colima status 2>/dev/null | grep -q "Running"; then
    colima start
fi

exec /opt/homebrew/bin/node /Users/juanoserver/nanoclaw-sandbox-4898/dist/index.js
