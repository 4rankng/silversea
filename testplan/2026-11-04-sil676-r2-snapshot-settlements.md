# Case SIL-676-R2 — round 3c follow-ups: snapshot vẫn 0 khi catalog thiếu lớp xe nền, trip revenue MANUAL NO_CARGO_TYPE, GET /api/settlements 403 cả admin

- Ticket: SIL-676 (id 783, high) — QA round-3c verdict on staging build
  386477c2 (pair 25, trips 292/293, Long Minh × route 6, cả 2 chân COMPLETED).
- Round-1 fix was CONFIRMED đúng 2 phần: `/api/pricing` trả 3.800.000 ✓,
  settlements UI redirect theo role ✓. Round-2 fixes the remaining defects.

## Root causes (verified staging read-only + local mirror :5441, 2026-11-04)

1. **Engine's vehicle-class catalog gate zeroed the price** — staging's
   `vehicle_size_classes` has NO plain `CONT20`/`CONT40` rows (only the
   LIGHT/HEAVY splits + trucks; the local seed has 2 extra rows, which is why
   round-1's local pair 29 passed while staging failed). `resolveFreightRate`
   hard-returned MANUAL with `pricingTableId: 0` on the missing catalog row
   BEFORE consulting the price sheet — snapshot rateTermsId=1 (terms resolved)
   but pricingTableId 0 + every amount 0/null; read side rebuilt the false
   "Thiếu giá gốc cho loại xe/container này" hint; driver detail "Chi phí 0".
   Evidence: staging snapshots 708/709 (`rate_terms_id=1, pricing_table_id=0,
   formula_text NULL`); staging `select * from vehicle_size_classes` = 14 rows
   (ids 1–14, no CONT20/CONT40).
2. **Trip revenue froze 0 via a second early exit** — `resolveFreightPrice`
   returns MANUAL `NO_CARGO_TYPE` ("Chưa có loại hàng") when the caller sends
   no cargo type; the dispatch issue flow sends none, so every dispatch-issued
   container trip froze `pricing_source=MANUAL`, `revenue=0` (staging pair 25
   AND round-1's local pair 29 both: `trip_financial_state.revenue=0`).
3. **`GET /api/settlements` alias carried OPS_ONLY** — round-1 wired the alias
   with the canonical route's gate, so admin (and every other role) got 403.
   Staging before (build 386477c2): admin/dungnv/tiepvv/bqhuong ALL 403 on
   `/api/settlements` AND `/api/ops/settlements` (captured
   `qa/2026-11-04-sil676-r2/staging-before-settlements.log`).

## Required behavior

- The engine prices from the customer's price sheet (ONE lane read through the
  pure selection law: exact keyed row → base class (card _58 inheritance) →
  general row → giá đầu bảng) regardless of the vehicle-class catalog; the
  catalog row is no longer read at all (the norm lookup is keyed by class CODE
  family). Amount = đúng dòng bảng giá × rate term (3.800.000 × 1.04 =
  3.952.000 với terms sharePct 4%); VETC/lương formulas untouched.
- A container-keyed trip issued without a cargo type (the dispatch flow) seeds
  `revenue` from the same sheet (selector = dispatcher `pricingRateKey`, else
  the snapshot's container-type-code mapping) instead of NO_CARGO_TYPE 0.
  Non-container trips keep the NO_CARGO_TYPE behavior untouched.
- `GET /api/settlements` reads for OPS (self-scoped — the canonical
  `/api/ops/settlements` policy) AND ADMIN (unscoped — the
  `/api/ops/admin/settlements` policy); every other role keeps the 403 of
  `/api/ops/settlements`. The canonical route itself is unchanged.

## Reproduction (before round-2 fix)

1. Soft-delete `vehicle_size_classes` rows `CONT20`/`CONT40` (staging shape) →
   dispatch a CONT20 leg → snapshot `pricing_table_id=0`, all amounts 0,
   `pricing_source` snapshot fine but `trip_financial_state.revenue` 0.
2. `GET /api/settlements` as admin → 403.
3. Driver detail of a COMPLETED leg shows "Chi phí 0".

## Cases (round-2)

- **S676-R6 (catalog-shaped pricing)**: with the plain CONT20/CONT40 class rows
  soft-deleted, a dispatched CONT20 leg (21 t → CONT20.HEAVY ask) freezes an
  AUTO snapshot = 3.800.000 × 1.04 = 3.952.000, `rate_terms_id=1`,
  `pricing_table_id=33`, formula records the inheritance. Verified local pair
  32 (trips 1271/1272, `qa/2026-11-04-sil676-r2/e2e-pair-staging-shape-run.log`).
- **S676-R7 (trip revenue source)**: same pair, `trip_financial_state.revenue`
  = 3.800.000 (bảng giá dòng) on BOTH legs, `pricing_source=TABLE`; totalCost,
  driverSalary, tollCost/tollDeduction non-zero (VETC 1 lần/cặp: leg A
  tollCost 110.000, leg B tollCost 0 + tollDeduction 110.000).
- **S676-R8 (settlements alias policy)**: `GET /api/settlements` → 200 for
  ADMIN (unscoped office list) + OPS (self-scoped), 403 for DISPATCHER/CUS/
  DRIVER; canonical `/api/ops/settlements` unchanged (OPS 200, ADMIN 403).
  Verified `qa/2026-11-04-sil676-r2/settlements-role-matrix.log`.
- **S676-R9 (round-1 pins keep green)**: `GET /api/pricing?customerId=1&routeId=6`
  → 3.800.000 (also with `pricingRateKey=CONT20`/`CONT40`); SPA `/settlements`
  role-redirect pins green.

## Limits

- Staging re-verify (pair on staging data + the 3 staging accounts) happens
  after the owner deploys round-2; this lane does NOT deploy. Before-evidence
  for staging captured read-only (403 matrix + snapshot rows).
- Driver surface: `/driver/me/trips` payload carries the pair salary
  (`driverSalary` 192.308/200.000) and `/driver/me/earnings` reports LIVE
  tripIncome; the driver payload has never carried `totalCost`/`tollCost`
  keys (ops/accounting composite surfaces do) — the "Chi phí 0" screenshot's
  exact widget maps to the salary surfaces verified here.
