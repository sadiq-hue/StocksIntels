#!/usr/bin/env bash
# StocksIntels - nightly Postgres backup on the Hetzner box.
# Schedules a pg_dump of the compose-managed database and prunes old dumps.
#
# Install in crontab (as deploy user or a user with docker access):
#   30 2 * * * /home/deploy/app/deploy/backup.sh >> /var/log/stockintel-backup.log 2>&1
#
# Restore a dump (replace the running DB):
#   cat /home/deploy/backups/stockintel-YYYY-MM-DD.sql.gz | docker exec -i $(docker compose -f /home/deploy/app/deploy/docker-compose.yml ps -q db) \
#     psql -U stockintel -d stockintel
# (Use the actual POSTGRES_USER/DB from your .env.)

set -euo pipefail

APP_DIR="/home/deploy/app"
COMPOSE_DIR="$APP_DIR/deploy"
BACKUP_DIR="/home/deploy/backups"
RETENTION_DAYS=14
DUMP_NAME="stockintel-$(date +%F-%H%M%S).sql.gz"

mkdir -p "$BACKUP_DIR"

# Read DB creds from the compose .env.
ENV_FILE="$APP_DIR/.env"
PGUSER=$(grep -E '^POSTGRES_USER=' "$ENV_FILE" | cut -d= -f2-)
PGPASS=$(grep -E '^POSTGRES_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)
PGDB=$(grep -E '^POSTGRES_DB=' "$ENV_FILE" | cut -d= -f2-)
PGUSER=${PGUSER:-stockintel}
PGDB=${PGDB:-stockintel}

# DB container id. Must run with --env-file so compose resolves ${...:?} vars.
DB_ID=$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_DIR/docker-compose.yml" ps -q db)

# Stream a pg_dump out of the container and compress it.
docker exec -e PGPASSWORD="$PGPASS" "$DB_ID" \
  pg_dump -U "$PGUSER" -d "$PGDB" --no-owner --no-acl | gzip > "$BACKUP_DIR/$DUMP_NAME"

echo "$(date -Is) wrote $BACKUP_DIR/$DUMP_NAME ($(du -h "$BACKUP_DIR/$DUMP_NAME" | cut -f1))"

# Prune old backups.
find "$BACKUP_DIR" -name 'stockintel-*.sql.gz' -mtime +"$RETENTION_DAYS" -delete
echo "$(date -Is) pruned backups older than ${RETENTION_DAYS} days"