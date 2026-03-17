#!/bin/bash
# backup.sh — Periodically push committed changes to GitHub

set -euo pipefail

cd "/Users/juanoserver/nanoclaw-sandbox-4898"

while true; do
  sleep 21600  # 6 hours

  # Load token from .env
  GITHUB_TOKEN=$(grep GITHUB_TOKEN .env 2>/dev/null | tail -1 | cut -d= -f2)
  if [ -z "$GITHUB_TOKEN" ]; then
    echo "[backup] No GITHUB_TOKEN found, skipping"
    continue
  fi

  git remote set-url origin "https://x-access-token:${GITHUB_TOKEN}@github.com/juan-uribe/nanoclaw.git"

  # Only push if there's something new
  if git status --porcelain | grep -q .; then
    git add -A
    git commit -m "chore: auto-backup $(date -u '+%Y-%m-%d %H:%M UTC')" || true
  fi

  git push --force-with-lease origin main && echo "[backup] Pushed at $(date -u)" || echo "[backup] Push failed at $(date -u)"
done
