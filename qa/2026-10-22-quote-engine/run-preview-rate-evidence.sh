#!/bin/bash
# QA R32 — preview-rate evidence (đủ căn cứ / thiếu căn cứ / lag khung giá).
# Backend: worktree feat-quote-engine-wiring, port 3009, dev DB 5441.
set -u
API=http://localhost:3009/api
QA=qa/2026-10-22-quote-engine
TOKEN=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d '{"identifier":"ketoan","password":"Abc123"}' | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))")
[ -z "$TOKEN" ] && { echo "LOGIN FAILED"; exit 1; }
LOG=$QA/preview-rate-driver.log
: > "$LOG"

probe() { # $1 = name, $2 = json body
  local name="$1"
  local body="$2"
  local out="$QA/preview-rate-$name.json"
  echo "=== POST /api/quotations/preview-rate ($name)" | tee -a "$LOG"
  echo "BODY: $body" | tee -a "$LOG"
  local code
  code=$(curl -s -o "$out" -w '%{http_code}' -X POST $API/quotations/preview-rate \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "$body")
  echo "HTTP $code → $out" | tee -a "$LOG"
  python3 -c "import json;d=json.load(open('$out'));print(json.dumps({k:d.get(k) for k in ('source','freight','surcharge','total','liters','billedKm','sharePct','heSo','fuelPricePeriodId','rateTermsId','pricingTableId','fuelNormId','quotationFrame','factoryName','routeId','formula')},ensure_ascii=False,indent=1))" | tee -a "$LOG"
  echo | tee -a "$LOG"
}

# Case 1 — ĐỦ căn cứ: Long Minh (1) × NEWEB (1) × CONT40 × 2026-09-20.
# Frame 1 "Mẫu báo giá 1" (effective 2026-09-15 ≤ ngày, lag 1) hiệu lực;
# lag 1 → target 2026-09-19 → kỳ dầu 2026-07-18 G=27.620 (PENDING-blocking
# chặn các kỳ sau). Kỳ vọng: E=91, J=4.182.000, H=889.744, K=5.071.744.
probe case1-du-can-cu '{"customerId":1,"routeId":1,"vehicleSizeClassCode":"CONT40","transportDate":"2026-09-20"}'

# Case 2 — THIẾU căn cứ: tuyến không có điều khoản cước của khách này.
# Kỳ vọng: source MANUAL, J/H/K = 0, formula nêu thiếu điều khoản — không bịa số.
probe case2-thieu-can-cu '{"customerId":1,"routeId":4,"vehicleSizeClassCode":"CONT40","transportDate":"2026-09-20"}'

# Case 3 — LAG KHUNG GIÁ điều khiển kỳ dầu: tạo khung tạm cho khách 1 hiệu lực
# 2026-09-16 với fuelPriceLagDays=71 (terms NEWEB vẫn lag 1). Target
# 2026-09-20 − 71 = 2026-07-11 → kỳ 2026-07-11 G=21.740 → H=354.664 (bảng §6.2).
FRAME=$(curl -s -X POST $API/quotations -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -H "Idempotency-Key: qa-r32-lag-frame-$(date +%s)" \
  -d '{"customerId":1,"templateName":"QA R32 lag-probe (xóa sau)","effectiveDate":"2026-09-16","surchargeRoundingMode":"NONE","fuelPriceLagDays":71}')
echo "=== POST /api/quotations (lag-probe frame): $FRAME" | tee -a "$LOG"
FRAME_ID=$(echo "$FRAME" | python3 -c "import sys,json;print(json.load(sys.stdin).get('id',''))")
probe case3-lag-khung-gia-71 '{"customerId":1,"routeId":1,"vehicleSizeClassCode":"CONT40","transportDate":"2026-09-20"}'

# Dọn khung tạm (soft delete) — không để lại dữ liệu QA trên DB dev.
if [ -n "$FRAME_ID" ]; then
  DEL=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE $API/quotations/$FRAME_ID \
    -H "Authorization: Bearer $TOKEN" -H "Idempotency-Key: qa-r32-lag-del-$(date +%s)")
  echo "=== DELETE /api/quotations/$FRAME_ID → HTTP $DEL" | tee -a "$LOG"
fi

# Xác nhận sau dọn: quay lại frame 1 lag 1 → K=5.071.744 như case 1.
probe case4-sau-khi-don '{"customerId":1,"routeId":1,"vehicleSizeClassCode":"CONT40","transportDate":"2026-09-20"}'
echo "DRIVER EXIT OK"
