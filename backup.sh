#!/bin/bash
# backup.sh — Commit any uncommitted changes and push to GitHub.
# Runs daily at 5:00 AM Mexico City time via cron.

set -euo pipefail

cd "/Users/juanoserver/nanoclaw-sandbox-4898"

# Load token from .env
GITHUB_TOKEN=$(grep GITHUB_TOKEN .env 2>/dev/null | tail -1 | cut -d= -f2)
if [ -z "$GITHUB_TOKEN" ]; then
  echo "[backup] No GITHUB_TOKEN found, skipping"
  exit 1
fi

git remote set-url origin "https://x-access-token:${GITHUB_TOKEN}@github.com/juan-uribe/nanoclaw.git"

# Refresh lease reference before pushing
git fetch origin main 2>/dev/null || true

# Commit if there are uncommitted changes
if git status --porcelain | grep -q .; then
  git add -A
  git commit -m "chore: auto-backup $(date -u '+%Y-%m-%d %H:%M UTC')" || true
fi

git push --force-with-lease origin main \
  && echo "[backup] Pushed at $(date -u)" \
  || echo "[backup] Push failed at $(date -u)"
