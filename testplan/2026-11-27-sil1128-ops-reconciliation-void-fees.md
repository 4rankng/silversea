# SIL-1128 — bảng Kiểm soát lô hàng không còn tính khoản VOID/REJECTED vào Phát sinh ĐV + Tổng trả

Case ID: SIL-1128-R1..R2 (QA evidence 27/11 — dòng lô 6 EHPH26080202
SHP-2609-00006, cont MNBU0000848; owner evidence comment 09:23).

**Ticket:** SIL-1128 — Phát sinh ĐV = 1.105.000 ₫ + Tổng trả = 1.105.000 ₫
trong khi Chi tiết Debit cùng lô chỉ 705.000 ₫ (chênh 400.000 ₫ = các khoản
đã VOID). Xóa khoản chi 200.000 ₫ → Chi tiết Debit giảm đúng 200.000 ₫, bảng
KHÔNG đổi.
**Owner (implement):** backend `accounting-debit-close.service.ts` — ops-expense
read của bảng Kiểm soát lô hàng (board chot-debit). Lưu ý: đề bài ghi tên
`ops-reconciliation-report.service` nhưng các cột Phát sinh ĐV/Tổng trả KHÔNG
tồn tại ở đó — owner thật là board read trên (xác minh bằng grep: 0 hit trong
ops-reconciliation-report.service.ts).
**Owner (verify):** qa
**Status (this doc):** READY — regression recorded prior to implementation per AGENTS.md §6
**Law:** LIVE money (CR-010.1 SIL-896) — `liveDebitOpsExpense()` + not-REJECTED
(SIL-882 "tự động gỡ") — đúng luật summary/Chi tiết Debit/merge đã ride.

---

## Root cause (verified in source)

Board read (`accounting-debit-close.service.ts`, khối "Lạch Huyện cells +
Phát sinh ĐV"):

```ts
.from(s.opsExpenseEntries)
.where(inArray(s.opsExpenseEntries.shipmentId, lotIds));
```

— KHÔNG có bộ lọc void/reject: khoản VOIDED (native + registry-voided qua
`expense_accounting_sources`) và REJECTED vẫn vào bucket `otherOpsByLot` /
`zoneCostByLot` → Phát sinh ĐV, Lạch Huyện ĐV, Tổng trả (tong1) đếm tiền chết.
Chi tiết Debit (`shipment-debit-summary.service`) và merge grid ride
`liveDebitOpsExpense()` (+ `ne(approvalStatus, 'REJECTED')` trên merge) nên
đúng — đó là đường chênh 400.000 ₫.

## Case SIL-1128-R1 — lô có khoản void → bảng khớp Chi tiết Debit

- **Given** lô có các khoản phí ĐV: một khoản RECORDED 705.000 ₫ và các khoản
  approval_status VOIDED (trực tiếp hoặc registry-voided).
- **When** GET `/api/accounting/debit-board`.
- **Then** Phát sinh ĐV = 705.000 ₫, Tổng trả khớp Chi tiết Debit của cùng lô
  (không còn 400.000 ₫ chết); khoản bị xóa thêm → bảng giảm đúng như Chi tiết
  Debit.

## Case SIL-1128-R2 — reject một khoản → không tăng

- **Given** lô có khoản phí approval_status = REJECTED (từ chối phí kích hoạt —
  cùng gốc theo owner evidence comment 09:23).
- **When** GET `/api/accounting/debit-board`.
- **Then** khoản REJECTED không vào Phát sinh ĐV / Tổng trả (không tăng).

## Chú ý an toàn

- d08ecc75 vừa sửa `ops-reconciliation-report.service.ts` (recorded advances) —
  fix này KHÔNG đụng file đó; pull rebase trước khi commit.
- Board's thu-side Lạch Huyện (customerCharge) đọc cùng read — cũng áp luật
  LIVE (same defect class, same shared owner).

## Verification

- BE scoped integration (harness debit-merge-route-regression: throwaway
  schema-only DB + router thật): R1/R2; BE unit source-scan pin board read mang
  `liveDebitOpsExpense()` + not-REJECTED; be-tsc xanh.

## What is NOT covered

- Các mặt khác đọc `ops_expense_entries` ngoài bảng Kiểm soát lô hàng
  (summary/detail/merge đã ride LIVE scope sẵn).
