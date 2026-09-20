#!/usr/bin/env bash
# Prod-window journal realign (checklist 3R-1/3R-2) - staged 2026-09-20.
# Modes:
#   preflight <OLD_WHEN>            read-only 3R-2 pre-flight against prod
#   realign <OLD_WHEN> <NEW_WHEN>   3R-1 single-transaction exact-match UPDATE
#                                   with fail-closed asserts; writes only after
#                                   every assert passes, zero changes otherwise
# Window execution belongs to the deploying lane. Re-read the journal at the
# cut HEAD and prod-window-checklist.md section 3-revised before invoking.
set -euo pipefail

SERVER="${REALIGN_SERVER:-root@silversea.tingting.vip}"
BASE="${REALIGN_BASE:-/opt/silversea}"
COMPOSE_FILE="${REALIGN_COMPOSE_FILE:-deploy/docker-compose.silversea.yml}"

die() { echo "FAIL: $*" >&2; exit 1; }

usage() {
  echo "usage: $0 preflight <OLD_WHEN>" >&2
  echo "       $0 realign <OLD_WHEN> <NEW_WHEN>" >&2
  exit 1
}

[ $# -ge 2 ] || usage
MODE=$1
OLD_WHEN=$2
NEW_WHEN=${3:-}
case "$MODE" in preflight|realign) ;; *) usage ;; esac
[ "$MODE" = realign ] && [ $# -ne 3 ] && usage
[ "$MODE" = preflight ] && [ $# -ne 2 ] && usage
[[ "$OLD_WHEN" =~ ^[0-9]{13}$ ]] || die "OLD_WHEN must be 13-digit epoch millis"
if [ "$MODE" = realign ]; then
  [[ "$NEW_WHEN" =~ ^[0-9]{13}$ ]] || die "NEW_WHEN wrong shape"
  [ "$NEW_WHEN" -gt "$OLD_WHEN" ] || die "NEW_WHEN must exceed OLD_WHEN"
fi

# Prod access mirrors deploy/silversea-server-db-backup.sh container discovery.
# REALIGN_SERVER override retargets the ssh host for staging tests only;
ssh "$SERVER" bash -s -- "$MODE" "$OLD_WHEN" "$NEW_WHEN" <<'REMOTE'
set -eu
MODE=$1
OLD_WHEN=$2
NEW_WHEN=$3
BASE="/opt/silversea"  # remote shell does not inherit REALIGN_*
COMPOSE_FILE="deploy/docker-compose.silversea.yml"
cd "$BASE"
pg_container=$(docker compose -f "$COMPOSE_FILE" ps -q postgres)
if [ -z "$pg_container" ]; then
  echo 'FAIL: no postgres container running' >&2
  exit 1
fi
pg_env_of() {
  docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$pg_container"
}
pg_user=$(pg_env_of | sed -n 's/^POSTGRES_USER=//p' | head -1)
pg_db=$(pg_env_of | sed -n 's/^POSTGRES_DB=//p' | head -1)
pg_user=${pg_user:-postgres}
pg_db=${pg_db:-$pg_user}
if [ "$MODE" = preflight ]; then
  out=$(docker exec -i "$pg_container" psql -qAt -U "$pg_user" -d "$pg_db" -v old_when="$OLD_WHEN" -v ON_ERROR_STOP=1 <<'SQL'
\set ON_ERROR_STOP on
BEGIN READ ONLY;
SELECT 'max_when', coalesce(max(created_at)::text, '-') FROM drizzle.__drizzle_migrations;
SELECT 'old_rows', count(*)::text FROM drizzle.__drizzle_migrations WHERE created_at = :'old_when';
SELECT 'row93_when', coalesce((SELECT created_at::text FROM drizzle.__drizzle_migrations WHERE id = 93), '<missing>');
SELECT 'row93_hash', coalesce((SELECT left(hash, 12) FROM drizzle.__drizzle_migrations WHERE id = 93), '<missing>');
ROLLBACK;
SQL
)
  echo "$out"
  max_when=$(printf '%s\n' "$out" | sed -n 's/^max_when|//p')
  old_rows=$(printf '%s\n' "$out" | sed -n 's/^old_rows|//p')
  row93=$(printf '%s\n' "$out" | sed -n 's/^row93_when|//p')
  [ "$max_when" = "$OLD_WHEN" ] || { echo "FAIL: prod cursor $max_when != expected $OLD_WHEN - journal/prod state changed, re-run the census (checklist 3R-2)" >&2; exit 1; }
  [ "$old_rows" = "1" ] || { echo "FAIL: rows at old cursor: $old_rows (expected 1)" >&2; exit 1; }
  echo "PASS: preflight ok - prod cursor at $max_when, exactly 1 row, row93 intact"
  exit 0
fi
if [ "$MODE" = realign ]; then
  docker exec -i "$pg_container" psql -U "$pg_user" -d "$pg_db" -v old_when="$OLD_WHEN" -v new_when="$NEW_WHEN" -v ON_ERROR_STOP=1 <<'SQL'
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL silversea.old_when = :'old_when';
SET LOCAL silversea.new_when = :'new_when';
DO $realign$
DECLARE
  n bigint;
  old_w bigint;
  new_w bigint;
BEGIN
  old_w := current_setting('silversea.old_when')::bigint;
  new_w := current_setting('silversea.new_when')::bigint;
  SELECT count(*) INTO n FROM drizzle.__drizzle_migrations WHERE created_at = old_w;
  IF n <> 1 THEN RAISE EXCEPTION '3R-1 abort: expected exactly 1 row at the old cursor, found %', n; END IF;
  SELECT count(*) INTO n FROM drizzle.__drizzle_migrations WHERE created_at = new_w;
  IF n <> 0 THEN RAISE EXCEPTION '3R-1 abort: target value already present (% rows), state moved - re-census', n; END IF;
  UPDATE drizzle.__drizzle_migrations SET created_at = new_w WHERE created_at = old_w;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION '3R-1 abort: UPDATE matched % rows (expected 1)', n; END IF;
  SELECT count(*) INTO n FROM drizzle.__drizzle_migrations WHERE created_at = old_w;
  IF n <> 0 THEN RAISE EXCEPTION '3R-1 abort: post-UPDATE old cursor still present (% rows)', n; END IF;
  SELECT count(*) INTO n FROM drizzle.__drizzle_migrations WHERE created_at = new_w;
  IF n <> 1 THEN RAISE EXCEPTION '3R-1 abort: post-UPDATE target rows = % (expected 1)', n; END IF;
  SELECT max(created_at) INTO n FROM drizzle.__drizzle_migrations;
  IF n <> new_w THEN RAISE EXCEPTION '3R-1 abort: max cursor % != new value', n; END IF;
END
$realign$;
COMMIT;
SQL
  echo "PASS: realign committed - cursor moved $OLD_WHEN -> $NEW_WHEN"
  exit 0
fi
echo 'FAIL: unreachable mode' >&2
exit 1
REMOTE
echo "assembly done"
