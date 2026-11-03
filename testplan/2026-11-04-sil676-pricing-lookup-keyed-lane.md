# Case SIL-676 — Pricing lookup bỏ qua bảng giá keyed: /api/pricing 0, revenue seed 0, snapshot trace-id zeroed sai, /settlements 404

- Ticket: SIL-676 (id 783, high) — observed on staging build 6737cbf1.
- Data: customer 1 × route 6 has 8 ACTIVE `pricing_tables` rows (deletedAt null,
  effective 2026-10-02; CONT20 3.800.000 id 33, CONT40 4.000.000 id 34,
  1.25T 1.200.000 … 10T 3.000.000) + `freight_rate_terms` id 1 (customer 1 ×
  route 6, effective 2026-10-02) — yet every money path read 0.

## Root causes (verified local mirror :5441 + source, 2026-11-04)

1. **Bare lane lookup → 0** (regression from 6cee01b1f, 03/08): `resolveTablePrice`
   (`backend/src/services/pricing.service.ts`) general fallback demands
   `containerTypeId IS NULL AND rateKey IS NULL`. Lanes whose rows are ALL
   rate-keyed (the seeded norm since FB-090) have no such row ⇒ MANUAL 0.
   Consumers: `GET /api/pricing` (config.service `getPricing`) and the trip
   revenue seed (`trip-create.service.ts` / `shipment-shared.service.ts` via
   `resolveFreightPrice` when the payload carries no selector) — revenue 0 on
   the created trips (staging TRP-202611-0077/0078 revenue 0).
2. **Snapshot trace ids zeroed on ANY engine 404**: engine throws 404 for BOTH
   "terms missing" and "vehicle class missing"; the lifecycle fallback
   (`resolveFreightRateWithManualFallback`) returns `MANUAL_ZERO_RESULT` with
   `rateTermsId: 0` even when Step 1 (terms) HAD resolved — the read side then
   rebuilds the hint "Thiếu điều khoản cước tự động (khách × tuyến chưa cấu
   hình)" (staging snapshot formula) although terms id 1 exists.
3. **`GET /api/settlements` + SPA `/settlements` never registered**: ops
   settlements list lives at `GET /api/ops/settlements` (ops.ts:309, OPS_ONLY,
   mounted under `/api/ops` at index.ts:221); the SPA exposes `/my-settlements`
   (FORWARDER), `/ops/wallet` (OPS), `/settlements/:id` print. Bare paths hit
   the 404 catch-all (index.ts:296) / SPA NotFound.

## Required behavior

- `GET /api/pricing?customerId=1&routeId=6` (no selector) resolves the lane's
  head-row price (latest `effectiveDate`, lowest `id` = CONT20 3.800.000).
  Explicit selectors keep exact-match semantics: a passed `containerTypeId` /
  `pricingRateKey` that misses still returns 0 (manual entry), never a
  cross-class guess.
- A dispatch/intake lock that resolves terms but misses a LATER parameter
  freezes a MANUAL snapshot carrying the REAL `rateTermsId` (truthful trace;
  hint no longer blames unconfigured terms).
- `GET /api/settlements` serves the ops settlements list with the same gate +
  self-scoping as `GET /api/ops/settlements`; SPA `/settlements` redirects
  each role to its existing settlements surface (no new page).

## Reproduction (before fix, local mirror)

1. `GET /api/pricing?customerId=1&routeId=6` → `{"price":0}`; with
   `pricingRateKey=CONT20` → `{"price":3800000}` (proves rows + engine fine).
2. Create a trip on route 6 without `pricingRateKey`/`containerTypeId` →
   `revenue` seed 0.
3. Engine 404 (missing vehicle-class code) → snapshot `rate_terms_id = 0`,
   formula hint blames "khách × tuyến chưa cấu hình".
4. `GET /api/settlements` → 404 `{"error":"Không tìm thấy API"}`; SPA
   `/settlements` → NotFound.

## Cases

- **S676-R1 (bare lookup)**: keyed-only lane, no selector → head-row price
  (CONT20 3.800.000), source TABLE.
- **S676-R2 (explicit miss stays manual)**: `pricingRateKey=15T` on a lane
  without a 15T row → 0 (manual), never CONT20's price.
- **S676-R3 (truthful trace)**: terms resolved + class missing → MANUAL
  snapshot with `rateTermsId = terms.id`, `pricingTableId = 0`; hint names the
  missing class, not unconfigured terms.
- **S676-R4 (settlements wired)**: `GET /api/settlements` (OPS) → 200 items;
  SPA `/settlements` redirects per role (OPS → /ops/wallet, FORWARDER →
  /my-settlements, office → /advances?view=settlements, CUS →
  /shipments-debit, DRIVER → /my-payslips, DISPATCHER → /dispatch).
- **S676-R5 (no regression)**: manual-entry lane (no rows at all) still
  returns 0 → manual entry flows untouched.

## Verification (2026-11-04, local mirror :5441 + fixed build :3102)

- HTTP before/after: `qa/2026-11-04-sil676/http-before-after-pricing-settlements.log`
  — bare `?customerId=1&routeId=6`: 0 → **3.800.000**; `pricingRateKey=CONT20`
  3.800.000 (both builds); `pricingRateKey=15T` → 0 (manual, no cross-class
  guess); `/api/settlements` (OPS): 404 → **200**.
- Pair E2E (KEP pair 29, trips 858/859, CONT20 route 6, local-equivalent lots
  per the brief — staging trips 253/254 unreachable from this workstation):
  snapshots 680/682 AUTO total 3.952.000 = 3.800.000 × (1 + 4.00 %),
  rate_terms_id=1, pricing_table_id=33 on BOTH legs; trip 858 tollCost 110.000
  (2 stations × 55.000) driverSalary 384.615 (base 5.000.000/26 × 2 wage
  days); trip 859 tollCost 0 with tollDeduction 110.000 (VETC 1 lần/cặp)
  driverSalary 200.000 (phụ phí Kẹp, `salary.pair_surcharge_kep`);
  `qa/2026-11-04-sil676/e2e-pair29-economics.txt`.
- UI (fixed SPA :7199 → fixed API :3102): `/settlements` (OPS) redirects to
  /ops/wallet, heading "Quỹ tạm ứng", no 404 text; in-page
  `GET /api/settlements` → 200; driver /my-trips/858 renders "Hoàn thành",
  /my-earnings renders "Lương chưa thanh toán 784.615 đ". Screenshot tool
  could not paint the tab (limitation recorded in ui-driver.log).
- Gates: backend tsc 0 errors; BE unit full 842/842
  (`qa/2026-11-04-sil676/be-unit-full.log`); frontend tsc -b 0 errors; FE
  vitest full suite + root lint — see qa/2026-11-04-sil676/ logs.
