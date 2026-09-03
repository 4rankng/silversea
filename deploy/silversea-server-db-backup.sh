#!/usr/bin/env bash
# Server-side pg_dump of the prod DB before the deploy migrate (set up by
# `make deploy`; called by the deploy-db-backup make target). Fails closed:
# a failed or suspiciously small backup aborts the deploy.
set -euo pipefail

SERVER="root@silversea.tingting.vip"
BASE="/opt/silversea"
COMPOSE="docker compose -f deploy/docker-compose.silversea.yml"

ssh "$SERVER" bash -s <<'REMOTE'
set -eu
cd /opt/silversea
mkdir -p .db-backups
pg_container=$(docker compose -f deploy/docker-compose.silversea.yml ps -q postgres)
if [ -z "$pg_container" ]; then
  echo 'No postgres container running' >&2
  exit 1
fi
pg_env_of() {
  docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$1"
}
pg_user=$(pg_env_of "$pg_container" | sed -n 's/^POSTGRES_USER=//p' | head -1)
pg_db=$(pg_env_of "$pg_container" | sed -n 's/^POSTGRES_DB=//p' | head -1)
pg_user=${pg_user:-postgres}
pg_db=${pg_db:-$pg_user}
backup=".db-backups/db-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker exec "$pg_container" pg_dump -U "$pg_user" -Fc "$pg_db" > "$backup"
size=$(wc -c < "$backup" | tr -d ' ')
if [ "$size" -lt 1024 ] && [ "$(docker exec "$pg_container" psql -U "$pg_user" -d "$pg_db" -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='public'")" -gt 0 ]; then
  echo "pg_dump suspiciously small ($size bytes) on a populated DB - aborting deploy; file kept: $backup" >&2
  exit 1
fi
echo "✅ Prod DB backup: /opt/silversea/$backup ($size bytes) [user=$pg_user db=$pg_db]"
REMOTE
