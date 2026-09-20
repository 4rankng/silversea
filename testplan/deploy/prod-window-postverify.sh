#!/usr/bin/env bash
# Prod-window post-migrate verification (checklist step 5) - staged 2026-09-20.
# READ-ONLY everywhere: psql SELECT probes + one public /api/health GET.
# Compares prod tracking against the journal at the CURRENT checkout HEAD, so
# run it from the repo at the cut HEAD after migrate. Checks:
#   - tracking sanity: row count, one-to-one when match with the journal,
#     no duplicates, no gaps (full sorted multiset diff)
#   - schema probes: shipment_code_counters / port_zone_surcharges /
#     debit_note_lots exist; ports_code_unique carries the partial WHERE
#     predicate; 22 trip-child + 40 shipment-child FKs; category + channel
#     columns present; billing_documents_active_period_unique gone
#   - /api/health: status ok, buildHash present, equals arg1 when given
# Fail-closed: every check reports PASS/FAIL, any FAIL exits 1. Window
# execution belongs to the deploying lane; this script never writes.
set -euo pipefail

die() { echo "FAIL: $*" >&2; exit 1; }

SERVER="${POSTVERIFY_SERVER:-root@silversea.tingting.vip}"
HEALTH_URL="${POSTVERIFY_HEALTH_URL:-https://silversea.tingting.vip/api/health}"
EXPECTED_HASH="${1:-}"

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
JOURNAL="$SCRIPT_DIR/../../backend/drizzle/meta/_journal.json"
[ -f "$JOURNAL" ] || die "journal not found at $JOURNAL - run from the repo checkout at the cut HEAD"
command -v jq >/dev/null || die "jq required locally"
JOURNAL_COUNT=$(jq '.entries | length' "$JOURNAL")
JOURNAL_WHENS=$(jq -r '.entries[].when' "$JOURNAL" | sort -n)
[ "$JOURNAL_COUNT" -ge 100 ] || die "journal count $JOURNAL_COUNT implausible - wrong file?"

fails=0
check_eq() { # name expected actual
  if [ "$2" = "$3" ]; then
    echo "PASS: $1 = $3"
  else
    echo "FAIL: $1 = $3 (expected $2)" >&2
    fails=$((fails+1))
  fi
}

# --- remote read-only probes -------------------------------------------
REMOTE_OUT=$(ssh "$SERVER" bash -s <<'REMOTE'
set -eu
BASE="/opt/silversea"
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
docker exec -i "$pg_container" psql -qAt -U "$pg_user" -d "$pg_db" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN READ ONLY;
SELECT 'rows_count', count(*) FROM drizzle.__drizzle_migrations;
SELECT 'max_when', coalesce(max(created_at)::text, '-') FROM drizzle.__drizzle_migrations;
SELECT 'counters_table', coalesce(to_regclass('shipment_code_counters')::text, '');
SELECT 'zone_table', coalesce(to_regclass('port_zone_surcharges')::text, '');
SELECT 'debit_lots', coalesce(to_regclass('debit_note_lots')::text, '');
SELECT 'ports_indexdef', coalesce((SELECT indexdef FROM pg_indexes WHERE indexname = 'ports_code_unique'), '');
SELECT 'old_billing_idx', count(*)::text FROM pg_indexes WHERE indexname = 'billing_documents_active_period_unique';
SELECT 'trip_fks', count(*)::text FROM pg_constraint WHERE contype = 'f' AND conname IN (
'ancillary_revenue_trip_id_fkey', 'billing_document_trip_claims_trip_id_fkey', 'delivery_attempts_trip_id_fkey', 'driver_incidental_costs_trip_id_fkey',
'driver_progress_events_trip_id_fkey', 'driver_work_days_trip_id_fkey', 'expense_accounting_sources_trip_id_fkey', 'freight_rate_snapshots_trip_id_fkey',
'fuel_evidence_reviews_trip_id_fkey', 'fuel_invoice_allocations_trip_id_fkey', 'penalties_trip_id_fkey', 'profitability_snapshots_trip_id_fkey',
'shipment_milestones_trip_id_fkey', 'trip_carrier_info_trip_id_fkey', 'trip_containers_trip_id_fkey', 'trip_expense_completion_scopes_trip_id_fkey',
'trip_expenses_trip_id_fkey', 'trip_financial_postings_trip_id_fkey', 'trip_financial_state_trip_id_fkey', 'trip_legs_trip_id_fkey',
'trip_photos_trip_id_fkey', 'trip_pod_submissions_trip_id_fkey'
);
SELECT 'shipment_fks', count(*)::text FROM pg_constraint WHERE contype = 'f' AND conname IN (
'ancillary_revenue_shipment_id_fkey', 'container_deposit_records_shipment_id_fkey', 'credit_override_requests_shipment_id_fkey', 'customer_email_logs_billing_document_id_fkey',
'customer_email_logs_shipment_id_fkey', 'customer_visible_events_shipment_id_fkey', 'debit_note_lots_shipment_id_fkey', 'delivery_attempts_shipment_id_fkey',
'dispatch_handoffs_shipment_id_fkey', 'expense_accounting_sources_shipment_id_fkey', 'freight_rate_snapshots_shipment_id_fkey', 'freight_rate_terms_route_id_fkey',
'fuel_norms_route_id_fkey', 'operational_sites_route_id_fkey', 'ops_expense_entries_shipment_id_fkey', 'payment_allocations_billing_document_id_fkey',
'pricing_tables_route_id_fkey', 'profitability_snapshots_shipment_id_fkey', 'road_allowances_route_id_fkey', 'salesperson_assignments_shipment_id_fkey',
'shipment_accounting_locks_billing_document_id_fkey', 'shipment_accounting_locks_shipment_id_fkey', 'shipment_change_requests_shipment_id_fkey', 'shipment_containers_route_id_fkey',
'shipment_cost_adjustments_shipment_id_fkey', 'shipment_cost_locks_shipment_id_fkey', 'shipment_declarations_shipment_id_fkey', 'shipment_document_custody_facts_shipment_id_fkey',
'shipment_documents_shipment_id_fkey', 'shipment_finance_actions_shipment_id_fkey', 'shipment_invoice_records_shipment_id_fkey', 'shipment_milestones_shipment_id_fkey',
'shipment_recovery_facts_shipment_id_fkey', 'shipment_status_history_shipment_id_fkey', 'shipments_route_id_fkey', 'trips_route_id_fkey',
'trips_shipment_id_fkey', 'user_shipment_links_shipment_id_fkey', 'user_shipment_pins_shipment_id_fkey', 'weight_pricing_tiers_route_id_fkey'
);
SELECT 'category_col', count(*)::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'forwarder_expense_types' AND column_name = 'category';
SELECT 'channel_col', count(*)::text FROM information_schema.columns WHERE table_name = 'shipment_declarations' AND column_name = 'channel';
COMMIT;
SQL
echo 'WHENS_BEGIN'
docker exec "$pg_container" psql -qAt -U "$pg_user" -d "$pg_db" -c "SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at;"
echo 'WHENS_END'
REMOTE
)

# --- parse --------------------------------------------------------------
PROBES=$(printf '%s\n' "$REMOTE_OUT" | sed -n '/^rows_count/,/^channel_col/p')
WHENS_PROD=$(printf '%s\n' "$REMOTE_OUT" | sed -n '/^WHENS_BEGIN$/,/^WHENS_END$/p' | sed '1d;$d')
val() { printf '%s\n' "$PROBES" | sed -n "s/^$1|//p" | head -1; }

# --- checks -------------------------------------------------------------
echo "== tracking sanity =="
check_eq "rows_count" "$JOURNAL_COUNT" "$(val rows_count)"
check_eq "max_when" "$(printf '%s\n' "$JOURNAL_WHENS" | tail -1)" "$(val max_when)"
if [ "$(printf '%s\n' "$JOURNAL_WHENS" | md5)" = "$(printf '%s\n' "$WHENS_PROD" | sort -n | md5)" ]; then
  echo "PASS: tracking whens match journal one-to-one (no dupes, no gaps)"
else
  echo "FAIL: prod tracking whens differ from journal - diff follows" >&2
  diff <(printf '%s\n' "$JOURNAL_WHENS") <(printf '%s\n' "$WHENS_PROD" | sort -n) >&2 || true
  fails=$((fails+1))
fi

echo "== schema probes =="
check_eq "counters_table" "shipment_code_counters" "$(val counters_table)"
check_eq "zone_table" "port_zone_surcharges" "$(val zone_table)"
check_eq "debit_lots" "debit_note_lots" "$(val debit_lots)"
PORTS_DEF=$(val ports_indexdef)
case "$PORTS_DEF" in
  *"WHERE"*"code IS NOT NULL"*"deleted_at IS NULL"*) echo "PASS: ports_code_unique partial predicate present" ;;
  *) echo "FAIL: ports_code_unique lacks partial predicate: $PORTS_DEF" >&2; fails=$((fails+1)) ;;
esac
check_eq "old_billing_idx" "0" "$(val old_billing_idx)"
check_eq "trip_fks" "22" "$(val trip_fks)"
check_eq "shipment_fks" "40" "$(val shipment_fks)"
check_eq "category_col" "1" "$(val category_col)"
check_eq "channel_col" "1" "$(val channel_col)"

echo "== /api/health =="
HEALTH_JSON=$(curl -fsS "$HEALTH_URL" || true)
[ -n "$HEALTH_JSON" ] || { echo "FAIL: /api/health unreachable at $HEALTH_URL" >&2; fails=$((fails+1)); }
STATUS=$(printf '%s' "$HEALTH_JSON" | grep -o '"status":"[^"]*"' | cut -d'"' -f4 || true)
BHASH=$(printf '%s' "$HEALTH_JSON" | grep -o '"buildHash":"[^"]*"' | cut -d'"' -f4 || true)
check_eq "health_status" "ok" "$STATUS"
if [ -n "$BHASH" ]; then
  echo "PASS: buildHash present: $BHASH"
else
  echo "FAIL: buildHash missing/empty in /api/health" >&2
  fails=$((fails+1))
fi
if [ -n "$EXPECTED_HASH" ]; then
  check_eq "buildHash_matches_cut" "$EXPECTED_HASH" "$BHASH"
else
  echo "NOTE: pass the cut buildHash as arg1 to assert it (got buildHash: $BHASH)"
fi

if [ "$fails" -eq 0 ]; then
  echo "POSTVERIFY PASS"
else
  echo "POSTVERIFY FAIL ($fails check(s) failed)" >&2
  exit 1
fi
