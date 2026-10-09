#!/bin/bash
# Card 081026230530 (FB-038) — lead staging QA, v2. The double-booking guard
# must block reassigning a truck whose IN_TRANSIT trip lacks plannedEndAt (8h
# coalesce law). Staging has no such occupant (round-8 fixture reverted), so
# this rung SEEDS one directly (staging is unrestricted), attempts the
# dispatcher reassign API expecting 409 + zero mutation, then removes the seed.
# SQL travels via stdin (psql -f -): no nested ssh quote hell.
set -u
API="https://vantai.tingting.vip/api"
QA="/Volumes/LexarSSD/projects/silversea-prod/qa"
LOG="$QA/2026-10-09_card081026230530-fb038-guard_ui-driver.log"
EXPECT="463712eb"
SEED_NOTE="QA seed LEAD FB-038 staging rung 2026-10-09 — self-authored, deleted by this rung"

q() { printf '%s\n' "$1" | ssh root@167.172.76.214 'cd /opt/vantai && docker compose -f deploy/docker-compose.prod.yml exec -T postgres psql -U vantai -d vantai -At -F"|" -f -' 2>>"$LOG"; }
log() { echo "{\"at\":\"$(date -u +%FT%TZ)\",\"step\":\"$1\",$2}" | tee -a "$LOG"; }

h=$(curl -s -m 15 "$API/health" | grep -o '"buildHash":"[^"]*"' | cut -d'"' -f4)
log health "\"buildHash\":\"$h\",\"expect\":\"$EXPECT\""
[ "$h" = "$EXPECT" ] || { log build-currency-FAIL '"result":"abort"'; exit 2; }

# B = reassignable issued trip: full window + fulfillment + truck + LIVE route
# (FCL resolves container route, otherwise shipment route — mirrors the
# reassign command's effectiveRouteId derivation; a null/deleted route trips
# the pre-guard 409 'Container chưa có tuyến đường hợp lệ' for ANY truck)
B=$(q "SELECT t.id, t.truck_id, t.driver_id, t.version, t.customer_id, t.route_id, t.planned_start_at, t.planned_end_at FROM trips t JOIN shipment_fulfillments f ON f.id = t.fulfillment_id JOIN shipments sh ON sh.id = t.shipment_id AND sh.deleted_at IS NULL WHERE t.status='CREATED' AND t.shipment_id IS NOT NULL AND t.fulfillment_id IS NOT NULL AND t.planned_start_at IS NOT NULL AND t.planned_end_at IS NOT NULL AND t.truck_id IS NOT NULL AND t.deleted_at IS NULL AND ((f.cargo_mode = 'FCL' AND EXISTS (SELECT 1 FROM shipment_containers c JOIN routes r ON r.id = c.route_id AND r.deleted_at IS NULL WHERE c.id = f.shipment_container_id)) OR (f.cargo_mode <> 'FCL' AND sh.route_id IS NOT NULL AND EXISTS (SELECT 1 FROM routes r WHERE r.id = sh.route_id AND r.deleted_at IS NULL))) ORDER BY t.id DESC LIMIT 5;")
[ -n "$B" ] || { log no-reassignable-trip '"result":"abort"'; exit 3; }
IFS='|' read -r tripB truckB driverB verB custB routeB startB endB <<< "$B"
log trip-B "\"id\":\"$tripB\",\"truck\":\"$truckB\",\"window\":\"$startB .. $endB\""

# T = a DIFFERENT truck with no CREATED/IN_TRANSIT overlap in B's window
T=$(q "SELECT t.id FROM trucks t WHERE t.id <> $truckB AND t.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM trips x WHERE x.truck_id = t.id AND x.deleted_at IS NULL AND x.status IN ('CREATED','IN_TRANSIT') AND x.planned_start_at IS NOT NULL AND coalesce(x.planned_end_at, x.planned_start_at + interval '8 hours') > timestamptz '$startB' AND x.planned_start_at < timestamptz '$endB') AND EXISTS (SELECT 1 FROM trucks dr WHERE dr.id = t.id) LIMIT 1;")
[ -n "$T" ] || { log no-free-truck '"result":"abort"'; exit 3; }
log truck-T "\"id\":\"$T\",\"note\":\"no existing overlap — seeded occupant will be the only conflict\""

# clear any leftover seed from an earlier aborted run, then seed fresh
q "DELETE FROM trips WHERE notes = '$SEED_NOTE';" >/dev/null
# seed the previously-invisible occupant: IN_TRANSIT, no plannedEndAt, inside B's window
SEED=$(q "INSERT INTO trips (customer_id, route_id, departure_date, truck_id, driver_id, status, planned_start_at, version, container_count, notes) VALUES ($custB, $routeB, CURRENT_DATE, $T, $driverB, 'IN_TRANSIT', timestamptz '$startB' + interval '30 minutes', 1, 1, '$SEED_NOTE') RETURNING id;")
SEED_ID=$(echo "$SEED" | grep -E '^[0-9]+$' | tail -1 | tr -d '[:space:]')
case "$SEED_ID" in ''|*[!0-9]*) log seed-FAIL "\"raw\":\"$SEED\""; exit 3;; esac
log seed-occupant "\"id\":\"$SEED_ID\",\"status\":\"IN_TRANSIT\",\"plannedEndAt\":\"NULL\",\"windowStart\":\"$startB +30m\""

# before-state of B (mutation proof)
BEFORE=$(q "SELECT id||' '||truck_id||' '||version||' '||updated_at FROM trips WHERE id=$tripB;")
log before "\"row\":\"$BEFORE\""

# dispatcher API write attempt
TOK=$(curl -s -m 15 -X POST "$API/auth/login" -H 'Content-Type: application/json' -d '{"identifier":"dungnv","password":"Abc123"}' | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))')
[ -n "$TOK" ] || { log login-FAIL '"result":"abort"'; q "DELETE FROM trips WHERE id=$SEED_ID;" >/dev/null; exit 2; }
CODE=$(curl -s -m 30 -o /tmp/fb038_resp.json -w '%{http_code}' -X PATCH "$API/trips/$tripB/reassign" \
  -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -H "Idempotency-Key: leadqa-fb038-$(date +%s)-$RANDOM" \
  -d "{\"carrierType\":\"OWN\",\"truckId\":$T,\"driverId\":$driverB,\"reason\":\"Lead QA staging FB-038 guard replay\",\"expectedVersion\":$verB}")
log api-attempt "\"status\":\"$CODE\",\"body\":\"$(head -c 300 /tmp/fb038_resp.json | tr '\n' ' ')\""

# after-state + seed removal
AFTER=$(q "SELECT id||' '||truck_id||' '||version||' '||updated_at FROM trips WHERE id=$tripB; DELETE FROM trips WHERE id=$SEED_ID;")
log after-and-cleanup "\"row\":\"$AFTER\""
GONE=$(q "SELECT count(*) FROM trips WHERE id=$SEED_ID;")
log seed-removed "\"remaining\":\"$GONE\""

if [ "$CODE" = "409" ] && grep -q 'trùng lịch' /tmp/fb038_resp.json && [ "$BEFORE" = "$(echo "$AFTER" | head -1)" ] && [ "$GONE" = "0" ]; then
  log PASS-guard-blocks "\"status\":409,\"message\":\"trùng lịch\",\"tripBUnchanged\":true,\"seedRemoved\":true"
  exit 0
else
  log FAIL "\"status\":\"$CODE\",\"unchanged\":\"$([ "$BEFORE" = "$(echo "$AFTER" | head -1)" ] && echo true || echo false)\""
  exit 1
fi
