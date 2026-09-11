#!/bin/bash
# Reusable staging smoke test — run from repo root
# Usage: bash testplan/qa/scripts/staging-smoke.sh [BASE_URL]
set -euo pipefail
BASE="${1:-https://vantai.tingting.vip}"
PASSWORD="${PASSWORD:-Abc123}"   # staging creds — see testplan/testaccounts.txt
API="$BASE/api"
PASS=0; FAIL=0

login() { curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' -d "{\"identifier\":\"$1\",\"password\":\"$PASSWORD\"}" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])"; }
api() { curl -s "$API/$1" -H "Authorization: Bearer $2"; }
check() { if echo "$2" | grep -q "$3"; then echo "  PASS: $1"; PASS=$((PASS+1)); else echo "  FAIL: $1 (expected '$3')"; FAIL=$((FAIL+1)); fi; }

echo "=== Staging Smoke — $(date +%Y-%m-%d) ==="
T_ADMIN=$(login admin); T_DISP=$(login dungnv); T_CUS=$(login thanhdc); T_DRV=$(login bqhuong)

echo "--- Auth ---"
check "Admin login" "$T_ADMIN" "eyJ"
check "Dispatcher login" "$T_DISP" "eyJ"
check "Customer login" "$T_CUS" "eyJ"
check "Driver login" "$T_DRV" "eyJ"

echo "--- D1.B1: IN_TRANSIT reassign blocked ---"
R=$(curl -s -w "\n%{http_code}" -X PATCH "$API/trips/11/reassign" -H "Authorization: Bearer $T_ADMIN" -H "Content-Type: application/json" -H "Idempotency-Key: smoke-$(date +%s)" -d '{"carrierType":"OWN","truckId":1,"driverId":1,"expectedVersion":99}')
check "IN_TRANSIT reassign returns 409" "$R" "409"

echo "--- D3.B1: External carriers ---"
C=$(api "shipments/dispatch-fleet?resource=EXTERNAL_CARRIER&limit=5" "$T_ADMIN")
check "External carriers list" "$C" '"items"'

echo "--- D4.B3: Plate→carrier reverse lookup ---"
PLATE=$(api "shipments/dispatch-fleet?resource=EXTERNAL_CARRIER&limit=1" "$T_ADMIN" | python3 -c "import sys,json;print(json.load(sys.stdin).get('items',[{}])[0].get('id',''))" 2>/dev/null)
if [ -n "$PLATE" ]; then
  REV=$(api "shipments/carrier-fleet-vehicles/resolve-carrier?plate=51K-TEST" "$T_ADMIN")
  check "Reverse lookup endpoint" "$REV" "carrierId"
fi

echo "--- D3.B4: Task tags ---"
TAGS=$(api "shipments/dispatch-task-tags" "$T_DISP")
check "Task tags list" "$TAGS" '"items"'

echo "--- D2.F2: Photo upload endpoint ---"
PHOTO_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API/uploads" -H "Authorization: Bearer $T_DRV")
check "Photo upload endpoint" "$PHOTO_STATUS" "403\|400\|404"

echo "--- Frontend pages ---"
for page in /dispatch /dispatch-detail /trips /shipments /fleet; do
  S=$(curl -s -o /dev/null -w "%{http_code}" "$BASE$page")
  check "$page returns 200" "$S" "200"
done

echo ""
echo "=== RESULT: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ] && echo "ALL GREEN" || echo "SOME FAILURES"
exit "$FAIL"
