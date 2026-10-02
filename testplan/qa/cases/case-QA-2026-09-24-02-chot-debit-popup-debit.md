# Case QA-2026-09-24-02 — Chọn Debit popup + TỔNG HỢP CÔNG NỢ (card `20260923_12`)

- **Case ID:** QA-2026-09-24-02
- **Card:** `20260923_12-chot-debit-popup-ky-lan-vat` (surface `/accounting/chot-debit`).
- **Requirement (work order §_12, verbatim):** *"khi tới kỳ chốt, lọc theo 'Tên khách hàng' … tích chọn
  ALL hoặc từng dòng trong kỳ lọc → chọn Debit → hệ thống hiện BẢNG NHỎ chọn: Từ ngày – Đến ngày
  (theo bộ lọc đã áp), Lần: 1,2,3…, Tháng 1–12, tick Phải thu/Phải trả (một chiều → tên đối tượng +
  số tiền), VAT tick 0/5/8/10% (hệ thống tự nhân…, cột Tổng tiền = phải trả + VAT), Ghi chú; dữ liệu
  bảng nhỏ tự động điền vào bảng TỔNG HỢP CÔNG NỢ KHÁCH HÀNG phía dưới (kỳ theo dõi = lần+tháng,
  VAT, ghi chú)."*
- **Surface:** `frontend/src/pages/accounting/AccountingDebitClosePage.tsx` +
  `DebitSettlementRoundDialog.tsx`; BE `backend/src/services/debit-settlement-rounds.service.ts`
  + routes on `accounting-debit.ts`; tables `debit_settlement_rounds`/`debit_settlement_round_lots`.
- **Roles:** unchanged OFFICE_ROLES (ADMIN/MANAGER/ACCOUNTANT).
- **Mutates:** creates one `debit_settlement_rounds` row + attachments per chốt on local/staging DB.

## Steps (positive path, per criterion)

1. Login `thanhdc`… roles: use `admin` or an ACCOUNTANT account (password `Abc123`), open
   `/accounting/chot-debit`, set Từ/Đến ngày covering a month with lots.
2. Tick one row (real tap) → click **Chọn Debit (1 dòng)** → the popup opens:
   Khách hàng + Nhà xe lines derived from selection, Từ/Đến ngày pre-filled from the applied filter
   (fallback = selection's own span), Lần=1, Tháng/Năm pre-filled from the range.
3. Tick **Phải thu (từ khách hàng)** → counterparty = customer name; Số tiền = Σ Tổng thu.
   Tick **Phải trả (cho nhà xe)** → counterparty = the single nhà xe; Số tiền = Σ Tổng 1.
4. Tick a VAT radio → Tiền VAT = amount × rate/100 and Tổng tiền = amount + VAT are shown.
5. Optionally type Ghi chú → click **Chốt đợt** → popup closes, page message names the đợt
   (Lần + kỳ + tổng tiền), board selection clears.
6. The **TỔNG HỢP CÔNG NỢ KHÁCH HÀNG** table below the board shows the round:
   Kỳ theo dõi "Lần N · MM/YYYY", khách, đối tượng, chiều, from/to, amounts, VAT, ghi chú.

## Negative (guard) checks — service-level, red-first (see suite evidence)

Mixed customers; lot EDD outside range; null EDD; VAT ∉ {0,5,8,10}; duplicate lần
(customer+month+direction); lot-overlap (a lot already in another round); TRA with mixed
nhà xe; pending rate-adjustment → 409; missing lot → 404. UI mirrors the pair guards
(disabled Chốt đợt + notes).

## Expected behavior

- One chốt = one đợt row per (customer, lần, tháng, direction) with the server-derived amount
  (THU = Σ Tổng thu, TRA = Σ Tổng 1 — Phí RU excluded, board P1 arithmetic), VAT, ghi chú.
- A lot joins at most one round ever (lot-overlap 400).
- TỔNG HỢP table = the read-back of persisted rounds (newest period first).

## Automated fence

- BE: `backend/src/tests/debit-settlement-rounds.test.ts` — 12 tests, isolated runner 1/1 green
  (red-first: guards observed failing pre-implementation via tsc TS2307 + suite failure).
- Board extension: `accounting-debit-close.test.ts` — 10/10 green (added carrierKeys/customerId test).
- FE: `AccountingDebitClosePage.test.tsx` — 10/10 green (popup fields, VAT math, submit body,
  error keeps popup open, TỔNG HỢP rows).

## Out of scope

- Round edit/reopen/delete (append-only ledger); billing-document stamping; TỔNG HỢP export;
  board-level Tháng filter (popup = act, not filter).
