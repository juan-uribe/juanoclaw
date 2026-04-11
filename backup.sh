#!/bin/bash
# backup.sh — Commit any uncommitted changes and push to GitHub.
# Runs as a background loop, waking at 5:00 AM Mexico City time (CST, UTC-6).

set -euo pipefail

REPO="/Users/juanoserver/nanoclaw-sandbox-4898"

seconds_until_5am() {
  # Seconds until next 05:00 CST (UTC-6 = UTC+offset -6)
  local now_utc now_h now_m target_utc delta
  now_utc=$(date -u +%s)
  # 5 AM CST = 11:00 UTC
  target_utc=$(date -u -j -f "%Y-%m-%d %H:%M:%S" \
    "$(date -u '+%Y-%m-%d') 11:00:00" +%s 2>/dev/null \
    || date -u -d "$(date -u '+%Y-%m-%d') 11:00:00" +%s)
  delta=$(( target_utc - now_utc ))
  # If we already passed 11:00 UTC today, aim for tomorrow
  [ "$delta" -le 0 ] && delta=$(( delta + 86400 ))
  echo "$delta"
}

while true; do
  secs=$(seconds_until_5am)
  echo "[backup] Sleeping ${secs}s until 5:00 AM CST ($(date -u -v+${secs}S '+%Y-%m-%d %H:%M UTC' 2>/dev/null || date -u -d "+${secs} seconds" '+%Y-%m-%d %H:%M UTC'))"
  sleep "$secs"

  cd "$REPO"

  # Load token from .env
  GITHUB_TOKEN=$(grep GITHUB_TOKEN .env 2>/dev/null | tail -1 | cut -d= -f2)
  if [ -z "$GITHUB_TOKEN" ]; then
    echo "[backup] No GITHUB_TOKEN found, skipping"
    continue
  fi

  git remote set-url origin "https://x-access-token:${GITHUB_TOKEN}@github.com/juan-uribe/nanoclaw.git"
  git fetch origin main 2>/dev/null || true

  if git status --porcelain | grep -q .; then
    git add -A
    git commit -m "chore: auto-backup $(date -u '+%Y-%m-%d %H:%M UTC')" || true
  fi

  git push --force-with-lease origin main \
    && echo "[backup] Pushed at $(date -u)" \
    || echo "[backup] Push failed at $(date -u)"
done
