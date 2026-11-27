# SIL-1081 — K2.120 merge-grid limb: ô tiền null hiện —, 0 thật hiện 0 ₫ trên Ghép bộ Debit

Case ID: SIL-1081-R1..R3 (owner FAIL 08:24 build 6398dfbc — chot-debit limb PASS
qua f9400a73, merge-grid limb vẫn FAIL).

**Ticket:** SIL-1081 — `/accounting/ghep-bo-debit` (DebitMergeGrid), lô 1210
(W3A-FCL-01 + cont 547).
**Owner (implement):** backend `debit-merge.service.ts` + frontend
`DebitMergeGrid.tsx` (MoneyCell).
**Owner (verify):** qa
**Status (this doc):** READY — regression recorded prior to implementation per AGENTS.md §6
**KB:** Ch.10 money law — null → hiển thị '—', 0 thật → '0 ₫'; KHÔNG bao giờ
render '0' cho null. Supersedes the merge grid's old "null → EMPTY" face exactly
like f9400a73 superseded SIL-814's blank face on the chot-debit board.

---

## Root causes (verified in source)

1. **PHỤ PHÍ '0' khi null** — `debit-merge.service.ts` grain loop sets
   `psAutoByLot` unconditionally (`psAutoByLot.set(lot, pick.surcharge)`): a
   priced freight snapshot whose `surchargeAmount` is 0 with zeroed fuel trace
   ids (`fuelNormId`/`fuelPricePeriodId` = 0) means fuel surcharge was never
   computed, not 0₫. The chot-debit board carries the K2.120
   `surchargeComputed` gate; the merge service's twin channel does not.
2. **PHÁT SINH (CUS) '0' khi null** — merge builds `revenueByLot` known from
   ANY trip_expense row, so a lot with only derived-type rows reads
   `revenue.otherSell = 0` → `phatSinhCus = '0'`. The board arms
   `phatSinhCus` known only from OTHER-sell rows.
3. **FE face** — `MoneyCell` renders an empty span for null; the law is
   '—' (a real 0 keeps '0 ₫' + muted class).

## Case SIL-1081-R1 — ô chưa xác định đọc — (không '0', không ô rỗng)

- **Given** lô 1210: board API `thu.phuPs` null, merge wire `revenue.phuPhi`
  phải null (không có phụ phí tính được); PHÁT SINH (CUS) không có OTHER row.
- **When** GET `/api/accounting/debit-merge` + render merge grid.
- **Then** wire: `revenue.phuPhi === null`, `revenue.phatSinh === null`.
  Cell map: CƯỚC 7.904.000 ₫ / LẠCH HUYỆN '—' / PHỤ PHÍ '—' / PHÁT SINH '—' /
  TỔNG 7.904.000 ₫.
- **Assert** không ô nào render '0' cho null; continuation container row vẫn ô
  rỗng (money lot-level, law SIL-912 không đổi).

## Case SIL-1081-R2 — 0 thật vẫn định dạng 0 ₫

- **Given** merge wire `revenue.phuPhi = '0'` (kênh phụ phí tính được bằng 0
  thật — computed financial zero, card 20261002_293).
- **When** render merge grid.
- **Then** ô đọc '0 ₫' với class `debit-merge-money__zero` (muted), không '—'.

## Case SIL-1081-R3 — parity chot-debit ↔ merge trên cùng lô

- **Given** lô snapshot freight có giá, phụ phí chưa tính (fuel trace ids = 0).
- **When** GET `/api/accounting/debit-board` (thu.phuPs) và
  `/api/accounting/debit-merge` (revenue.phuPhi).
- **Then** cả hai trả null — hai mặt không còn lệch luật.

## Verification

- BE scoped: mở rộng `debit-merge-override-zero.test.ts` (harness router thật +
  throwaway DB) cho R1/R3; BE unit source-scan pin cổng surchargeComputed.
- FE scoped vitest: `DebitMergeGrid.test.tsx` money-laws — null → '—',
  0 thật → '0 ₫'; cập nhật pin "empty cell" cũ thành luật mới (supersession).
- `pnpm exec tsc --noEmit` (frontend) + be-tsc xanh.

## What is NOT covered

- Đáp ứng staging chưa harvest backend mới (FE không normalize '0' từ backend
  cũ trên grid merge — backend đã sửa cùng commit).
