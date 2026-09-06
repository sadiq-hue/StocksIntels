#!/usr/bin/env bash
# StocksIntels - one-time DB export from Railway (run on your local machine or a
# temp box that has the Railway CLI + psql/pg_dump available).
#
# Produces: ./stockintel-railway-export.sql  (pure SQL, no owner/acl, compatible
# with the local Postgres on Hetzner).
#
# 1) Ensure the Railway CLI is linked and DATABASE_URL points at the Railway PG:
#      railway link
#      railway variables   # copy DATABASE_URL
# 2) Run this script with DATABASE_URL set, or export it in your shell first.

set -euo pipefail

# Pull the DB URL from the Railway CLI if not already set.
export DATABASE_URL="${DATABASE_URL:-$(railway variables 2>/dev/null | grep -i 'DATABASE_URL' | head -1 | cut -d'│' -f2- | tr -d ' ')}"

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL not set. Get it via: railway variables" >&2
  exit 1
fi

OUT="stockintel-railway-export.sql"
echo "Exporting Railway Postgres -> $OUT ..."
pg_dump --no-owner --no-acl -Fc "$DATABASE_URL" -f "$OUT"
echo "Done: $(du -h "$OUT" | cut -f1)"

echo
echo "Next step (on the Hetzner box, after 'docker compose up -d --build'):"
echo "  cat $OUT | gunzip -c > /tmp/db.dump  # if .sql plain, just scp it"
echo "  docker cp $OUT stack_db_1:/tmp/db.dump"
echo "  docker exec stack_db_1 pg_restore -U stockintel -d stockintel /tmp/db.dump"
