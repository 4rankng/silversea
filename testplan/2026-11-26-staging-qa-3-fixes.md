# Regression Cases — 2026-11-26 Staging QA Fixes

Recorded prior to implementation per `AGENTS.md §6`.

---

## Case ID: QA-20261126-01 — Debit Merge `TỔNG TC` double-counts OPS-projected `trip_expenses` (P0)

- **Route / Surface:** `/accounting/ghep-bo-debit` (`GET /api/debit-merge`), `/shipments-debit`, `backend/src/services/debit-merge.service.ts`
- **Reproduction:**
  1. Lot with an approved Ops expense projected onto `trip_expenses` via `expense_accounting_sources` (`source_kind = 'OPS'`, `linked_trip_expense_id = trip_expenses.id`), e.g. `MATS7539769000` (`Phí nâng vỏ` `7.603.200 ₫`, HĐ `360402`) + `CƯỚC` `20.910.000 ₫` + `CSHT` `2.500.000 ₫` + `Chọn vỏ` `50.000 ₫` + `Hải quan luồng xanh` `450.000 ₫`.
  2. Open `/accounting/ghep-bo-debit`, search `MATS7539769000`, inspect `TỔNG TC`.
- **Actual (bug):** `revenueRows` in `debit-merge.service.ts` did not apply `liveDebitTripExpense()` and `standaloneDebitTripRevenue()`, so OPS-projected `trip_expenses` were summed into `revenue.derived` in addition to `opsChargeByLot` — inflating `TỔNG TC` from `31.513.200 ₫` to `39.116.400 ₫` (+`7.603.200 ₫`).
- **Expected:** `revenueRows` filters with both `liveDebitTripExpense()` and `standaloneDebitTripRevenue()` (matching `shipment-debit-summary.service.ts`), so each approved Ops expense contributes to `TỔNG TC` exactly once (`31.513.200 ₫`).

---

## Case ID: QA-20261126-02 — Phơi phiếu `Lô chưa thanh toán` Drawer `BIỂN KIỂM SOÁT` truncation & horizontal cell collision (P1)

- **Route / Surface:** `/accounting/phoi-phieu` → Báo cáo Phải trả → `Lô chưa thanh toán — XE NHÀ — SILVER SEA` drawer (`PhoiPhieuControlPage.css`, `PhoiPhieuPartyLotsDrawer.tsx`)
- **Reproduction:**
  1. Log in as Accountant (see `testplan/testaccounts.txt`), open `/accounting/phoi-phieu` at 1440×900.
  2. Open `Lô chưa thanh toán` for `XE NHÀ — SILVER SEA`.
- **Actual (bug):** Under `table-layout: fixed; min-width: 972px`, column widths (`bill` ~100px, `container` ~85px, `plate` ~76px, `date` ~71px) are narrower than real `nowrap` tokens (`STPKHHHPH26A07`, `MBBU2000210`, `15C-184.62`, `07/09/2026`) and header `BIỂN KIỂM SOÁT`, causing header clipping (`BIỂN KIỂM`, `SỐ BILL / BOO`) and adjacent cell text collisions.
- **Expected:** Drawer table column floors and `min-width` hold full headers (`SỐ BILL / BOOKING`, `CONTAINER`, `BIỂN KIỂM SOÁT`, `NGÀY`) and real data tokens with zero clipping and zero horizontal overlap; the drawer wrapper scrolls cleanly horizontally when wider than the drawer content box.

---

## Case ID: QA-20261126-03 — `/dispatch-detail` batch-release blocked reason renders 1-char-per-line in 48px checkbox column (P2)

- **Route / Surface:** `/dispatch-detail` (`DetailedPlanGrid.tsx`, `DetailedPlanGrid.css`)
- **Reproduction:**
  1. Log in as Dispatcher (see `testplan/testaccounts.txt`), open `/dispatch-detail` at 1440×900.
  2. Toggle `[Phát lệnh hàng loạt]` mode with completed/ineligible rows visible.
- **Actual (bug):** `<span className="detailed-plan-grid__bulk-reason">` was rendered inside the 48px `.detailed-plan-grid__cell--select` checkbox column with `word-break: break-word`, wrapping `"Đã hoàn thành — lịch sử đóng băng."` vertically 1 character per line and stretching row height to ~250px.
- **Expected:** The 48px `PHÁT LỆNH` checkbox column renders only the checkbox (with `title={reason}` tooltip); `.detailed-plan-grid__bulk-reason` renders inside the wide `THỜI GIAN & LỊCH TRÌNH` cell (≥200px wide) so blocked rows stay compact while still showing the textual reason inline on the row.
