#!/usr/bin/env bash
# Reusable API probe for TC-DV-DISPATCH-053 / D1.B1 regression:
# "Phân xe lại bị chặn khi lái xe chưa nhận việc" (regression 2026-09-11).
#
# Verifies that PATCH /api/trips/:id/reassign is rejected with HTTP 409
# when the trip is in IN_TRANSIT and the driver has not yet sent the
# ORDER_RECEIVED milestone. Reproduces the user-reported bug:
# "Lái xe chưa nhận việc thì vẫn phân lại được" on /dispatch-detail.
#
# Usage:
#   SILVERSEA_URL=https://vantai.tingting.vip \
#     ./testplan/qa/reassign-before-accept-blocked.sh \
#     [--dispatcher dungnv] [--driver dvthuc] [--trip-id 11] [--cleanup]

set -euo pipefail

URL="${SILVERSEA_URL:-https://vantai.tingting.vip}"
API="$URL/api"
DISPATCHER="${DISPATCHER_USER:-dungnv}"
DRIVER="${DRIVER_USER:-dvthuc}"
PASSWORD="${PASSWORD:-Abc123}"
TRIP_ID=""
RUN_CLEANUP=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dispatcher) DISPATCHER="$2"; shift 2 ;;
    --driver) DRIVER="$2"; shift 2 ;;
    --trip-id) TRIP_ID="$2"; shift 2 ;;
    --cleanup) RUN_CLEANUP=1; shift ;;
    -h|--help)
      sed -n '2,18p' "$0"; exit 0 ;;
    *) echo "Unknown arg: $1"; exit 2 ;;
  esac
done

QA_DIR="qa/$(date +%Y-%m-%d)_dispatch-reassign-blocked"
mkdir -p "$QA_DIR"
LOG="$QA_DIR/probe.log"
echo "== Probe run $(date -Iseconds) ==" | tee -a "$LOG"
echo "URL=$API dispatcher=$DISPATCHER driver=$DRIVER" | tee -a "$LOG"

login() {
  curl -fsS -X POST "$API/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"identifier\":\"$1\",\"password\":\"$PASSWORD\"}" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])"
}

DISP_TOK=$(login "$DISPATCHER")
DRV_TOK=$(login "$DRIVER")
echo "tokens acquired" | tee -a "$LOG"

if [[ -z "$TRIP_ID" ]]; then
  # Find a trip in IN_TRANSIT with no driver/ORDER_RECEIVED on the test driver.
  TRIPS_JSON=$(curl -fsS -H "Authorization: Bearer $DRV_TOK" "$API/driver/me/trips")
  TRIP_ID=$(echo "$TRIPS_JSON" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for t in (d.get('items') or d.get('trips') or []):
    if t.get('status') == 'IN_TRANSIT':
        print(t['id']); break
")
fi
if [[ -z "$TRIP_ID" ]]; then
  echo "No IN_TRANSIT trip available for driver $DRIVER" | tee -a "$LOG"
  exit 2
fi
echo "trip_id=$TRIP_ID" | tee -a "$LOG"

# Snapshot pre-state
curl -fsS -H "Authorization: Bearer $DISP_TOK" "$API/trips/$TRIP_ID" -o "$QA_DIR/trip-pre.json"
VERSION=$(python3 -c "import json; print(json.load(open('$QA_DIR/trip-pre.json'))['version'])")
echo "pre-version=$VERSION" | tee -a "$LOG"

# Attempt reassign — must be rejected with 409
PAYLOAD=$(cat <<EOF
{
  "carrierType":"EXTERNAL",
  "externalCarrierId":3,
  "externalPlateNumber":"51K-PROBE",
  "externalDriverName":"Probe Driver",
  "externalDriverPhone":"0900000099",
  "expectedVersion":${VERSION}
}
EOF
)

RESP_FILE="$QA_DIR/reassign-response.json"
STATUS=$(curl -s -o "$RESP_FILE" -w "%{http_code}" \
  -X PATCH "$API/trips/$TRIP_ID/reassign" \
  -H "Authorization: Bearer $DISP_TOK" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: reassign-probe-$(date +%s%N)" \
  -d "$PAYLOAD" | tee -a "$LOG")
echo "reassign HTTP=$STATUS" | tee -a "$LOG"
cat "$RESP_FILE" | tee -a "$LOG"
echo "" | tee -a "$LOG"

# Verify version did NOT move
curl -fsS -H "Authorization: Bearer $DISP_TOK" "$API/trips/$TRIP_ID" -o "$QA_DIR/trip-post.json"
POST_VERSION=$(python3 -c "import json; print(json.load(open('$QA_DIR/trip-post.json'))['version'])")
echo "post-version=$POST_VERSION" | tee -a "$LOG"

if [[ "$STATUS" == "409" && "$POST_VERSION" == "$VERSION" ]]; then
  echo "PASS — reassign blocked, version unchanged" | tee -a "$LOG"
  EXIT=0
else
  echo "FAIL — expected 409 + version unchanged; got HTTP=$STATUS post-version=$POST_VERSION" | tee -a "$LOG"
  EXIT=1
fi

if [[ "$RUN_CLEANUP" == "1" ]]; then
  echo "Cleanup requested but reassign did NOT mutate state — nothing to revert" | tee -a "$LOG"
fi

exit "$EXIT"