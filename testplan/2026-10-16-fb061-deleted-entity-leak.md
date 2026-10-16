# Case FB-061 fix — soft-deleted masters leak into phơi phiếu board + money report (2026-10-16)

Source: W5+W4 verify MAJOR finding (`testplan/2026-10-16-w5-w4-verify.md`
§Findings 1, re-pinned on build 9e400e63). Owner instruction 2026-10-16:
permanent code fix (A) + targeted data scrub (B).

## Defect class

`backend/src/services/phoi-phieu-control.service.ts` joins master tables
(customers / suppliers) without the soft-delete predicate, so tombstoned QA or
real entities resurface by name on the two reports:

| # | Surface | Join path | Evidence (staging) |
|---|---|---|---|
| 1 | Board (`listPhoiPhieuRows`) | `carrierCustomer` ← `trip_carrier_info.external_entity_id` (`EXTERNAL/CUSTOMER`) | row 14, lot `EBKG18452303`: `Nhà vận tải: STG VERIFY NHA XE 09` — customers id 23, deleted_at 2026-10-04, reached via trip_carrier_info id 28 |
| 2 | Board (`listPhoiPhieuRows`) | `carrierSupplier` ← same, `EXTERNAL/SUPPLIER` | same class; no staging hit today |
| 3 | Money report THU (`getPhoiPhieuReport kind=THU`) | `s.customers` ← `trips.customer_id` | row 55 party `QA0915 QA-138 Credit Customer` (0 live / 1 deleted) |
| 4 | Money report TRA (`getPhoiPhieuReport kind=TRA`) | `carrierCustomer`/`carrierSupplier` ← trip_carrier_info | same class as 1/2 |
| 5 | Sibling sweep: `getPhoiPhieuDeposit` | `s.customers` ← `shipments.customer_id` | same class; board detail dialog (đã nhận phơi) |

Already correct (pinned, unchanged): board `s.customers` join
(`shipments.customer_id`) and `supplierCarrierCustomer` join both filter
`deleted_at IS NULL`.

## Expected behavior after fix

- Every customers/suppliers join in the two reports (and the sibling deposit
  lookup) carries `isNull(deletedAt)`.
- Board: a trip whose carrier entity is soft-deleted renders the designed
  fallback `Đơn vị vận chuyển không còn trong danh mục` (already in
  `externalCarrierName`'s coalesce chain) — never the deleted name. The plate
  column keeps `external_plate_number` (real operational data).
- Money report: money of a trip whose customer is soft-deleted keeps reporting
  (never silently dropped) but buckets under `Chưa xác định` — the same law the
  NULL-trip branch already follows. No deleted NAME may surface.
- Live masters keep resolving by name (positive control against over-filter).

## Regression cases

- `backend/src/tests/phoi-phieu-soft-delete-leak.test.ts` (new):
  - LEAK-1 board: EXTERNAL/CUSTOMER carrier soft-deleted → carrierName is the
    fallback, not the name; live carrier control still named.
  - LEAK-2 board: EXTERNAL/SUPPLIER carrier soft-deleted → fallback; live
    supplier-carrier control still named.
  - LEAK-3 money THU: soft-deleted trip customer → its money row exists under
    `Chưa xác định`, deleted name absent; live customer row named.

## Data scrub (B) — staging

`trip_carrier_info` id 28 (trip 12) keeps a dangling
`external_entity_id=23/customers` link (customer soft-deleted 2026-10-04).
Scrub = null the entity link (keep carrier_type EXTERNAL, plate, driver name —
real operational data of a live trip). Evidence: before/after SELECT + guarded
UPDATE, `qa/2026-10-16_fb061-scrub_*`.

## Gates

- `cd backend && npx tsc --noEmit` → 0
- `cd backend && pnpm exec tsx --test src/tests/phoi-phieu-soft-delete-leak.test.ts` → pass
- `pnpm lint` → 0 errors
