# Case SIL-682 — "Tích duyệt" chi phí lái xe trong Chi tiết tiền đường luôn 404

- **Case ID:** SIL-682 (board id 794)
- **Reported:** 2026-11-06, QA (hoapt/Kế toán, staging build dcaa8295, lô 832 / SHP-2611-00338 /
  R4B-CC-001, chuyến 347 / TRP-202611-0109, lái xe Bùi Quang Hường).
- **Surface:** backend `POST /api/expense-accounting/confirm` + the id space the "Chi tiết tiền đường"
  dialog (`PhoiPhieuTienDuongDialog`) sends. FE is NOT mutated by this fix.
- **Mutation surface:** `expense_accounting_sources.confirmed_at/version` (the confirm write), plus
  its downstream ledger/trip-cost refresh — unchanged by the fix, only reached now.
- **Status:** PREPARED — root cause identified (card 20261005_373 relabelled the tiền-đường row's
  `sourceId` to `expense_accounting_sources.id` for the void route; `confirmAccountingExpenses`
  still resolves `(DRIVER, sourceId)` against the native `driver_incidental_costs.id`).

## Root cause

Two id spaces share one wire field: dialog rows carry `expense_accounting_sources.id` (23/24) while
the confirm endpoint expects the native driver-cost id (2/3). Native resolution misses →
`ensureLegacyExpenseSource` → 404 "Không tìm thấy chi phí thuộc lô." Direct API with native ids
2/3 returns 200 (QA evidence on staging). The dialog's `saveAll` (update/correct) sends the same
sources-PK id, so `/entries/DRIVER/:id/update|correct` carry the identical mismatch.

## Steps

1. Login Kế toán (hoapt) → /accounting → tab "Phơi phiếu / tiền đường" → row R4B-CC-001 →
   "Xem chi tiết" → dialog "Chi tiết tiền đường R4B-CC-001".
2. GET `/api/expense-accounting/phoi-phieu/:tripId/tien-duong` → row `sourceId` = sources PK.
3. Press "Tích duyệt" on "Phí nâng container" 150.000 ₫ → POST `/expense-accounting/confirm`
   `{ entries: [{ sourceKind: 'DRIVER', sourceId: <sources PK>, expectedVersion: <sources.version> }] }`.

## Expected

- Confirm returns 200; row shows "Đã duyệt"; dialog "Đã duyệt" total increases (150.000 ₫, then
  270.000 ₫ for both rows); the board's Tiền đường column follows.
- `expense_accounting_sources.confirmed_at` set for the row; DRIVER-linked trip expense approved.
- Update/correct from the same dialog keep working with the sources-PK id (same resolution law).

## Local rung (2026-11-06, branch fix/sil-be-682-683)

- DB/API VERIFIED (2). BEFORE (base dcaa8295 on :3002): confirm `{DRIVER, 5000}` → HTTP 404
  "Không tìm thấy chi phí thuộc lô." (`qa/2026-11-06-lane-be/driver-sil682-before.log`).
- AFTER: HTTP 200, `expense_accounting_sources.confirmed_at` set, tien-duong row `confirmed:true`,
  totals `confirmed:150000` (`driver-sil682-after2.log`). Update path (dialog "Lưu") with the same
  alias id: native row amount actually changes (`driver-sil682-update-after2.log`).
- Not covered: UI DRIVEN click-through (FE untouched by this BE lane; driver mirrors the exact FE
  call from `PhoiPhieuTienDuongDialog.tsx` + `phoiPhieuClient.ts`).
