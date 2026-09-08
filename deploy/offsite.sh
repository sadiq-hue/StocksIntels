#!/usr/bin/env bash
# StocksIntels - push nightly backups off-site (disaster recovery).
# Uploads the newest Postgres dump to remote targets configured in rclone:
#   b2:<bucket>            Backblaze B2 (independent of Hetzner)
#   hbstorage:<path>       Hetzner Storage Box (SFTP) via rclone
# Keeps a rolling window on the B2 side via rclone's --max-age prune.
#
# Install in crontab (as deploy), run shortly AFTER backup.sh (2:30):
#   40 2 * * * /home/deploy/app/deploy/offsite.sh >> /home/deploy/logs/stockintel-offsite.log 2>&1
#
# Requires: rclone in ~/.local/bin and configured remotes 'b2:' and 'hbstorage:'.

set -euo pipefail

export PATH="$HOME/.local/bin:$PATH"
RCLONE="$HOME/.local/bin/rclone"
BACKUP_DIR="/home/deploy/backups"
LOG_DIR="/home/deploy/logs"
RETENTION_DAYS="${OFFSITE_RETENTION_DAYS:-30}"   # days to keep on B2
REMOTE_DIR="stockintel-backups"

mkdir -p "$LOG_DIR"
log() { echo "$(date -Is) $*"; }

if [ ! -x "$RCLONE" ]; then
  log "ERROR: rclone not found at $RCLONE" >&2
  exit 1
fi

# Newest dump (by filename timestamp).
LATEST=$(ls -1t "$BACKUP_DIR"/stockintel-*.sql.gz 2>/dev/null | head -1)
if [ -z "$LATEST" ]; then
  log "ERROR: no backup found in $BACKUP_DIR" >&2
  exit 1
fi
log "latest dump: $LATEST ($(du -h "$LATEST" | cut -f1))"

# 1) Backblaze B2
if $RCLONE lsd b2: >/dev/null 2>&1; then
  log "uploading to b2:${REMOTE_DIR}/..."
  if $RCLONE copy "$LATEST" "b2:${REMOTE_DIR}/" --log-level ERROR; then
    log "uploaded to B2"
    # Prune old remote dumps older than window.
    $RCLONE delete "b2:${REMOTE_DIR}/" --min-age "${RETENTION_DAYS}d" --log-level ERROR 2>/dev/null \
      && log "pruned B2 dumps older than ${RETENTION_DAYS}d" || true
  else
    log "ERROR: B2 upload failed" >&2
  fi
else
  log "WARN: rclone remote 'b2:' not configured - skipping B2"
fi

# 2) Hetzner Storage Box
if $RCLONE lsd hbstorage: >/dev/null 2>&1; then
  log "uploading to hbstorage:${REMOTE_DIR}/..."
  if $RCLONE copy "$LATEST" "hbstorage:${REMOTE_DIR}/" --log-level ERROR; then
    log "uploaded to Storage Box"
  else
    log "ERROR: Storage Box upload failed" >&2
  fi
else
  log "WARN: rclone remote 'hbstorage:' not configured - skipping Storage Box"
fi

log "off-site sync complete"