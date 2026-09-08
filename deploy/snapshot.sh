#!/usr/bin/env bash
# StocksIntels - nightly Hetzner server snapshot.
# Creates a snapshot of the whole VPS disk (OS + app + data volume) so a disk
# failure / bad deploy can be rolled back in minutes by rebuilding from the
# snapshot image. This complements deploy/backup.sh (Postgres dumps) — the
# snapshot is a full-system image, the dump is a logical DB backup.
#
# Requires: hcloud CLI + authenticated context for the deploy user
#   (see ~/.config/hcloud/cli.toml — e.g. `hcloud context create default`)
#
# Install in crontab (as deploy):
#   30 3 * * * /home/deploy/app/deploy/snapshot.sh >> /home/deploy/logs/stockintel-snapshots.log 2>&1

set -euo pipefail

HCLOUD="$HOME/.local/bin/hcloud"
LOG_DIR="/home/deploy/logs"
SERVER_NAME="${SNAPSHOT_SERVER_NAME:-ubuntu-4gb-hel1-1}"
KEEP="${SNAPSHOT_KEEP:-3}"          # most recent snapshots to retain
LABEL="stockintel=auto-snapshot"    # label used to mark/manage our snapshots

mkdir -p "$LOG_DIR"
export PATH="$HOME/.local/bin:$PATH"

log() { echo "$(date -Is) $*"; }

if [ ! -x "$HCLOUD" ]; then
  log "ERROR: hcloud CLI not found at $HCLOUD" >&2
  exit 1
fi

TODAY="$(date +%F-%H%M)"
DESC="stockintel-vps-$TODAY"

log "creating snapshot: $DESC"
$HCLOUD server create-image "$SERVER_NAME" --type snapshot \
  --description "$DESC" --label "$LABEL"
log "snapshot created: $DESC"

# Prune: keep the most recent $KEEP snapshots carrying our label, oldest first.
# hcloud image delete takes an image ID or name; our snapshots have empty names,
# so delete by ID. We list id+description, sort by description (timestamp),
# and drop the newest $KEEP.
$HCLOUD image list --type snapshot --selector "$LABEL" -o json \
  | python3 -c "
import json, sys
imgs = json.load(sys.stdin)
# Sort newest-first and drop the newest KEEP, i.e. keep IDs of the older ones.
pairs = sorted(((i['description'], i['id']) for i in imgs), reverse=True)
for _, img_id in pairs[${KEEP}:]:
    print(img_id)
" | while read -r img_id; do
    log "deleting old snapshot id=$img_id"
    $HCLOUD image delete "$img_id"
  done
log "done; keeping newest ${KEEP} snapshot(s)"
