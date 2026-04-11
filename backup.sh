#!/bin/bash
# backup.sh — Daily backup at 5:00 AM Mexico City time (CST, UTC-6).
#
# Two backups run each cycle:
#   1. CODE  → juan-uribe/nanoclaw           (commits any uncommitted changes)
#   2. DATA  → juan-uribe/personal-nanoclaw-backup (DB dump, sessions, group memory, config)
#
# Secrets (.env, ~/.config/nanoclaw/secrets/) are never backed up.

set -euo pipefail

REPO="/Users/juanoserver/nanoclaw-sandbox-4898"
BACKUP_DIR="$HOME/.nanoclaw-backup"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

log() { echo "[backup] $*"; }

seconds_until_5am() {
  local now_utc target_utc delta
  now_utc=$(date -u +%s)
  # 5 AM CST = 11:00 UTC (Jalisco is UTC-6, no DST)
  target_utc=$(date -u -j -f "%Y-%m-%d %H:%M:%S" \
    "$(date -u '+%Y-%m-%d') 11:00:00" +%s 2>/dev/null \
    || date -u -d "$(date -u '+%Y-%m-%d') 11:00:00" +%s)
  delta=$(( target_utc - now_utc ))
  [ "$delta" -le 0 ] && delta=$(( delta + 86400 ))
  echo "$delta"
}

load_token() {
  GITHUB_TOKEN=$(grep GITHUB_TOKEN "$REPO/.env" 2>/dev/null | tail -1 | cut -d= -f2)
  if [ -z "$GITHUB_TOKEN" ]; then
    log "No GITHUB_TOKEN in .env — skipping both backups"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# 1. Code backup → juan-uribe/nanoclaw
# ---------------------------------------------------------------------------

backup_code() {
  log "--- Code backup ---"
  cd "$REPO"
  git remote set-url origin "https://x-access-token:${GITHUB_TOKEN}@github.com/juan-uribe/nanoclaw.git"
  git fetch origin main 2>/dev/null || true

  if git status --porcelain | grep -q .; then
    git add -A
    git commit -m "chore: auto-backup $(date -u '+%Y-%m-%d %H:%M UTC')" || true
  fi

  git push --force-with-lease origin main \
    && log "Code pushed at $(date -u)" \
    || log "Code push failed at $(date -u)"
}

# ---------------------------------------------------------------------------
# 2. Data backup → juan-uribe/personal-nanoclaw-backup
# ---------------------------------------------------------------------------

backup_data() {
  log "--- Data backup ---"

  # Init repo if first run
  if [ ! -d "$BACKUP_DIR/.git" ]; then
    mkdir -p "$BACKUP_DIR"
    git -C "$BACKUP_DIR" init
    git -C "$BACKUP_DIR" checkout -b main 2>/dev/null || true
    git -C "$BACKUP_DIR" remote add origin \
      "https://x-access-token:${GITHUB_TOKEN}@github.com/juan-uribe/personal-nanoclaw-backup.git"
  else
    git -C "$BACKUP_DIR" remote set-url origin \
      "https://x-access-token:${GITHUB_TOKEN}@github.com/juan-uribe/personal-nanoclaw-backup.git"
  fi

  # .gitignore (safety net — secrets should never land here anyway)
  cat > "$BACKUP_DIR/.gitignore" << 'EOF'
secrets/
*.keys.json
.env
EOF

  # 1. SQLite dump (text format, diffs cleanly)
  mkdir -p "$BACKUP_DIR/store"
  sqlite3 "$REPO/store/messages.db" .dump > "$BACKUP_DIR/store/messages.sql" 2>/dev/null \
    && log "DB dumped" || log "WARNING: DB dump failed"

  # 2. Session files (agent conversation context)
  mkdir -p "$BACKUP_DIR/sessions"
  rsync -a --delete --exclude='*.log' \
    "$REPO/data/sessions/" "$BACKUP_DIR/sessions/" 2>/dev/null \
    && log "Sessions synced" || log "WARNING: sessions sync failed"

  # 3. Group folders (agent memory, notes, files — excludes logs)
  mkdir -p "$BACKUP_DIR/groups"
  rsync -a --delete --exclude='logs/' \
    "$REPO/groups/" "$BACKUP_DIR/groups/" 2>/dev/null \
    && log "Groups synced" || log "WARNING: groups sync failed"

  # 4. Allowlist config (phone numbers — private, no secrets)
  mkdir -p "$BACKUP_DIR/config"
  cp "$HOME/.config/nanoclaw/sender-allowlist.json" "$BACKUP_DIR/config/" 2>/dev/null \
    && log "Allowlist config copied" || log "WARNING: allowlist config not found"

  # Commit and push
  git -C "$BACKUP_DIR" add -A
  if git -C "$BACKUP_DIR" status --porcelain | grep -q .; then
    git -C "$BACKUP_DIR" -c user.name="backup" -c user.email="backup@nanoclaw" \
      commit -m "backup: $(date -u '+%Y-%m-%d %H:%M UTC')"
  fi

  git -C "$BACKUP_DIR" push origin main --force-with-lease 2>/dev/null \
    || git -C "$BACKUP_DIR" push origin main --force 2>/dev/null \
    || git -C "$BACKUP_DIR" push --set-upstream origin main \
    && log "Data pushed at $(date -u)" \
    || log "Data push failed at $(date -u)"
}

# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

while true; do
  secs=$(seconds_until_5am)
  log "Sleeping ${secs}s until 5:00 AM CST ($(date -u -v+${secs}S '+%Y-%m-%d %H:%M UTC' 2>/dev/null || date -u -d "+${secs} seconds" '+%Y-%m-%d %H:%M UTC'))"
  sleep "$secs"

  load_token || continue
  backup_code
  backup_data
done
