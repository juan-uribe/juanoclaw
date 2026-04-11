#!/bin/bash
# backup.sh — Daily backup at 5:00 AM local time (11:00 UTC / CST).
#
# Two backups run each cycle:
#   1. CODE  → $CODE_REPO  (commits any uncommitted changes)
#   2. DATA  → $BACKUP_REPO (DB dump, sessions, group memory, config)
#
# Configure in .env:
#   CODE_REPO=username/nanoclaw
#   BACKUP_REPO=username/nanoclaw-backup
#
# Secrets (.env, ~/.config/nanoclaw/secrets/) are never backed up.

set -euo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"
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

load_config() {
  GITHUB_TOKEN=$(grep ^GITHUB_TOKEN "$REPO/.env" 2>/dev/null | tail -1 | cut -d= -f2)
  CODE_REPO=$(grep ^CODE_REPO "$REPO/.env" 2>/dev/null | tail -1 | cut -d= -f2)
  BACKUP_REPO=$(grep ^BACKUP_REPO "$REPO/.env" 2>/dev/null | tail -1 | cut -d= -f2)

  if [ -z "$GITHUB_TOKEN" ]; then
    log "No GITHUB_TOKEN in .env — skipping both backups"
    return 1
  fi
  if [ -z "$CODE_REPO" ]; then
    # Fall back to current git remote
    CODE_REPO=$(git -C "$REPO" remote get-url origin 2>/dev/null \
      | sed 's|https://[^@]*@github.com/||;s|https://github.com/||;s|\.git$||')
  fi
}

# ---------------------------------------------------------------------------
# 1. Code backup → $CODE_REPO
# ---------------------------------------------------------------------------

backup_code() {
  log "--- Code backup ($CODE_REPO) ---"
  cd "$REPO"
  git remote set-url origin "https://x-access-token:${GITHUB_TOKEN}@github.com/${CODE_REPO}.git"
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
# 2. Data backup → $BACKUP_REPO
# ---------------------------------------------------------------------------

backup_data() {
  if [ -z "${BACKUP_REPO:-}" ]; then
    log "No BACKUP_REPO in .env — skipping data backup"
    return 0
  fi

  log "--- Data backup ($BACKUP_REPO) ---"

  # Init repo if first run
  if [ ! -d "$BACKUP_DIR/.git" ]; then
    mkdir -p "$BACKUP_DIR"
    git -C "$BACKUP_DIR" init
    git -C "$BACKUP_DIR" checkout -b main 2>/dev/null || true
    git -C "$BACKUP_DIR" remote add origin \
      "https://x-access-token:${GITHUB_TOKEN}@github.com/${BACKUP_REPO}.git"
  else
    git -C "$BACKUP_DIR" remote set-url origin \
      "https://x-access-token:${GITHUB_TOKEN}@github.com/${BACKUP_REPO}.git"
  fi

  # .gitignore — secrets must never land in the backup repo
  cat > "$BACKUP_DIR/.gitignore" << 'EOF'
# Environment files and secrets
.env
*.env
secrets/
*.keys.json

# WhatsApp auth credentials
**/auth/
**/creds.json

# Claude Code credentials
**/.credentials.json

# Certificates and private keys
**/*.pem
**/*.key
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
# Main loop  (pass --now to skip sleep and run immediately)
# ---------------------------------------------------------------------------

if [[ "${1:-}" == "--now" ]]; then
  log "Running immediately (--now)"
  load_config || exit 1
  backup_code
  backup_data
  exit 0
fi

while true; do
  secs=$(seconds_until_5am)
  log "Sleeping ${secs}s until 5:00 AM CST ($(date -u -v+${secs}S '+%Y-%m-%d %H:%M UTC' 2>/dev/null || date -u -d "+${secs} seconds" '+%Y-%m-%d %H:%M UTC'))"
  sleep "$secs"

  load_config || continue
  backup_code
  backup_data
done
