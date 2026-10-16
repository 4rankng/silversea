#!/bin/zsh
# W5+W4 staging verify — read-only DB proof + sanctioned dry-run purge census.
# READ-ONLY: SELECT queries only; the purge is the --dry-run census (no writes).
# NOTE (memory 2026-09-12): docker exec -i + heredoc truncation — here stdin is
# the deliberate pipe into psql, and nothing follows it in the remote command.
set -uo pipefail
cd "$(dirname "$0")/.."   # repo root (this script lives in qa/)

OUT="qa/2026-10-16_w5w4_db-proof.log"

{
  echo "-- W5+W4 DB proof $(date -u +%Y-%m-%dT%H:%M:%SZ), staging DB via ssh (READ-ONLY SELECTs)"
  echo
  echo "-- W4 sentinels: every row must be a TOMBSTONE (deleted_at not null), zero live rows"
  echo "-- pricing_tables price=777888001"
  echo "SELECT id, customer_id, route_id, price, container_type_id, rate_key, effective_date, deleted_at FROM pricing_tables WHERE price = '777888001' ORDER BY id;"
  echo "-- road_allowances base_amount=777888002"
  echo "SELECT id, route_id, trailer_type, base_amount, deleted_at FROM road_allowances WHERE base_amount = '777888002' ORDER BY id;"
  echo "-- lift_pricing unit_price=777888003"
  echo "SELECT id, port_id, container_type_id, direction, load_state, unit_price, effective_date, deleted_at FROM lift_pricing WHERE unit_price = '777888003' ORDER BY id;"
  echo
  echo "-- FB-061 census: QA fixture signatures on staging (all must be 0 on staging-clean surfaces)"
  echo "SELECT 'trip_carrier_info QA rows' AS census, count(*) FROM trip_carrier_info WHERE external_plate_number ILIKE 'QA%' OR external_plate_number = '99T-99999' OR external_plate_number ILIKE '51K-PROBE%' OR external_driver_name ILIKE 'Test Driver%';"
  echo "SELECT 'trucks QA rows' AS census, count(*) FROM trucks WHERE license_plate ILIKE 'QA%' OR license_plate = '99T-99999' OR license_plate ILIKE '51K-PROBE%';"
  echo "SELECT 'drivers QA rows' AS census, count(*) FROM drivers WHERE name ILIKE 'QA%' OR name ILIKE 'Test Driver%';"
  echo "SELECT 'shipments live BL-QAKE/E2E rows (board-visible)' AS census, count(*) FROM shipments WHERE deleted_at IS NULL AND (bl_number ILIKE 'BL-QAKE%' OR booking_ref ILIKE 'BL-QAKE%' OR shipment_code ILIKE 'BL-QAKE%' OR bl_number ILIKE 'E2E-%' OR booking_ref ILIKE 'E2E-%');"
  echo "-- the two families the board actually renders (board hit rows 14 + 55)"
  echo "SELECT 'suppliers STG VERIFY% (live / deleted)' AS census, count(*) FILTER (WHERE deleted_at IS NULL) AS live, count(*) FILTER (WHERE deleted_at IS NOT NULL) AS deleted FROM suppliers WHERE name ILIKE 'STG VERIFY%';"
  echo "SELECT 'customers QA0915% (live / deleted)' AS census, count(*) FILTER (WHERE deleted_at IS NULL) AS live, count(*) FILTER (WHERE deleted_at IS NOT NULL) AS deleted FROM customers WHERE name ILIKE 'QA0915%';"
  echo "-- the board's row-14 carrier chain: trip_carrier_info → external_entity supplier"
  echo "SELECT ci.id, ci.trip_id, ci.external_plate_number, ci.external_driver_name, ci.external_entity_id, s.name AS supplier_name, s.deleted_at AS supplier_deleted_at FROM trip_carrier_info ci LEFT JOIN suppliers s ON s.id = ci.external_entity_id WHERE ci.external_plate_number = '15H-021.39';"
  echo "-- trucks QA rows detail"
  echo "SELECT id, license_plate, status, deleted_at FROM trucks WHERE license_plate ILIKE 'QA%' OR license_plate = '99T-99999' OR license_plate ILIKE '51K-PROBE%';"
} | ssh root@vantai.tingting.vip "docker exec -i vantai-postgres-1 sh -c 'psql -U \$POSTGRES_USER -d \$POSTGRES_DB -tA'" > "$OUT" 2>&1
rc=$?
echo "psql exit=$rc, output → $OUT"
tail -40 "$OUT"
exit $rc
