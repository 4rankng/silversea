# checks.md — per-check transcript (flows/12 pricing regression, 2026-09-10)

All HTTP statuses are raw endpoint responses captured in the logged-in browser session (admin unless noted). UI checks ran in the shared AgentsRoom browser tab on http://localhost:7180.

## (a) Preview AUTO anchor — PASS (API-driven)

- `GET /api/pricing/freight-preview?customerId=1525&routeId=1196&vehicleSizeClassCode=CONT20&transportDate=2026-09-12`
- → 200 `{source: "AUTO", freight: 3,978,000, surcharge: 813,480, total: 4,791,480, fuelDelta: 9,777.4074, billedKm: 260, liters: 83.2, sharePct: 2, rateTermsId: 1, pricingTableId: 68, fuelNormId: 8, fuelPricePeriodId: 2, formula: "3900000 × (1 + 2.00%) = 3978000 + MAX(0, (27620.00 − 17842.5926) × 83.200) = 4791480"}`
- Math check: 3,900,000 × 1.02 = 3,978,000; (27,620 − 17,842.5926) × 83.2 = 813,480; sum = 4,791,480 ✓

## (b) MANUAL hint on terms-less route — PASS (API-driven)

- `GET /api/pricing/freight-preview?customerId=1525&routeId=11&vehicleSizeClassCode=NEWEB...` → 200 `source: MANUAL`, formula = "Không tìm thấy hint naming customer #1525, route #11" (exact string in RUN-SUMMARY)

## (c) 15T AUTO ×3 routes — PASS (API-driven)

- NEWEB(1196): freight 3,570,000 (total 4,332,638)
- ASKEY(1197): freight 3,536,000
- SUNRISE+SJ(1198): freight 3,587,500
- All source=AUTO (D4/D5 demo seed `3ee09b58` live)

## (d) Override contract + UI — PASS (API + UI-DRIVEN)

- Setup: lot 132085 (Long Minh × NEWEB, FCL, container TEST2234564 via `PUT /shipments/132085/containers` 200) → CUS line update (`POST /api/shipments/cus-workspace/132085/containers/71146`, 200) fired the lock → snapshots 270→271 (INSERT-only chain, distinct computed_at, NO updates — TC-CUOC-009/010/016 live evidence; snapshot 271: terms 1, table 68, norm 8, period 2, billed_km 260, liters 83.2)
- GET `/api/pricing/snapshots/271/override` → **404** (none yet — UI reads as null)
- PUT `{finalDebitFreight: 5000000}` (diff, no reason) → **400** (reason-iff-diff)
- PUT with reason → **200**, override row 34 (system 4,791,480 → final 5,000,000, reason recorded)
- UI: `/shipments/132085` as admin → section **"Giá cước — điều chỉnh báo nợ"** rendered; system 4.791.480 ₫ read-only; final input pre-filled 5,000,000; reason pre-filled; save button live. Component contract proven E2E (404-as-null hook → save → row).

## (e) Driver /my-trips "Chạy ngoài" label — PASS (UI-DRIVEN)

Full dispatch pipeline executed against lot 132084 (ad-hoc):
1. Canonical create `POST /api/handshake`-style: `POST /api/shipments` → 201 (no containers key — guard e12454cf/1b77b722 respected)
2. Container intake `PUT /api/shipments/132084/containers` → 200 (TEST1234560, check-digit validated server-side; 3 format errors en route — see §findings)
3. Carrier allocation `POST /api/shipments/132084/carrier-allocations` (OWN, 1×20DC) → 200
4. Handoff resolve ACCEPT (v1→2→3 via If-Match on version bumps) → created fulfillment 67287
5. Container reconcile canceled 67287; CUS line update recreated it as **67288** (+ fired the engine lock → ad-hoc bypass → 0 snapshots = CORRECT per docx §2-D)
6. `POST /api/ships/132084/dispatch` → 409 "Rơ-moóc không phù hợp" → truck 4 20FT busy → **201 trip 51972** (OWN truck 5 = 15H-055.79, 20FT trailer, driver laixe)
7. Login laixe → `/my-trips` → card renders: tag ĐƠN + **"Chạy ngoài"** (rgb(164,93,28), transparent bg — colored text, no badge) + route + appointment

## (f) CUS workboard row label — PARTIAL

- Data layer: workboard API rows carry `raw.isAdHoc` (incl. hybrid lot 132084: isAdHoc=true AND customerId=1525 — hybrid state confirmed via PUT keeping isAdHoc while setting customerId)
- UI: test lots never surfaced on workboard page 1 (default today-window + QA fixture flood + search submit not automatable via synthetic events); the row markup is the same `[data-adhoc-label]` span verified on 3 other surfaces.
- Screenshot gap honestly declared in RUN-SUMMARY.

## Findings recorded during the run

1. **Ad-hoc dispatch gate:** `POST /:id/dispatch` rejects customer-less ad-hoc lots (400 "Lô chạy ngoài chưa có khách hàng trên danh mục") because `trips.customer_id` is NOT NULL. Pure raw-name ad-hoc lots can never be dispatched → the T7 driver-app label is only reachable for **hybrid** lots (raw name + later-linked catalog customer). If the product wants pure ad-hoc dispatch, the trips schema must relax customer_id (backend lane / PRD decision). Documented here + flagged to PM.
2. **ISO-6346 validation is strict and live:** 3 rejected payloads (format + check digit); the 4-letter owner code + valid check digit REQUIRED (error example "MSKU1236457" is illustrative, not check-valid). Frontend test fixtures everywhere use valid numbers (e.g., TEST1234560).
3. Dispatched lots lock EDD (edit boundary) — EDD change on dispatched 132084 → 400; re-used lot 126225 for the (f) attempt instead.