# Regression case QA-2026-09-24-08 — Báo-gia import: giá/liters row errors are preview-visible and commit-parity (single source of truth)

- **Case ID:** QA-2026-09-24-08
- **Card:** 20260922_57 (D1, Director ruling 2026-09-24)
- **Surface:** `/config` quotations import (preview + commit) — `/api/quotations/import` and `/api/quotations/import/commit`
- **Status:** prep staged (patch `plans/reports/c12-be-card57-d1.patch`, diff base `7fbc01db`) — implementation queued behind the quotation wrap-up landing
- **Roles:** ACCOUNTANT / ADMIN

## Preconditions

- Backend patch applied (D1 shared validator); FE (WIP component) renders `row.error` verbatim (already does in the WIP tree).
- A customer + route exist matching the workbook's name+MST / factory name.

## Repro (first try)

1. Login ACCOUNTANT or ADMIN (roster: `testplan/testaccounts.txt`).
2. Prepare two workbooks on the import layout contract (11-column grid; rows: identity, fuel, factory, class labels, Hệ số, Tổng lít, Giá cos):
   a. **empty-giá file**: identical to the customer's file but with ONE Giá cos cell blank (e.g. Cont20 >20t).
   b. **clean file**: same layout, every Giá cos and Tổng lít filled > 0.
3. Preview the empty-giá file on the import dialog (chọn file → xem trước).
4. Attempt Ghi nhận (button state = evidence), then commit the empty-giá file via API.
5. Preview + commit the clean file.

## Expected

1. **Preview (empty-giá file):** the blank row renders a blocking `✗` line with a row-level error naming factory, class label, sheet row, sheet column, and expected format:
   `ASKEY · Cont20 >20t (hàng 7, cột 9): thiếu hoặc sai Giá cos — điền số tiền > 0 (số, VD 1234567 hoặc 1.234.567).`
   Filled rows keep `✓ … lít · … ₫`. Banner: `N lỗi ánh xạ — sửa file hoặc báo quản trị.` (N ≥ 1); Ghi nhận disabled.
2. **Commit parity (the teeth):** committing the empty-giá file writes NOTHING (quotationId null for the sheet) and its per-sheet error list contains the SAME strings the preview showed — no divergence, no new message family, no silent zero/skip.
3. **Clean file:** preview banner `khớp toàn bộ — bấm Ghi nhận để nhập.`, commit creates the frame (v1 Nhập file version), export round-trips the figures to the đồng.
4. Unit pins: `import-gia-validation.test.ts` — blank cell → `row.error` with `hàng 7`/`cột 3`/`Giá cos`/label; parity both directions; clean file green.

## Pass criteria

- All three rungs hold in one session; no quotation frame exists from the errored commit; console clean.
