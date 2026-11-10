# SIL-728 (id 848) — Nút xác nhận hoàn ứng: thu hồi tiền ứng số dư âm về Quỹ công ty

- Ticket: SIL-728 (board SIL, id 848, tạo 07/11/2026, HIGH). Lane K1.
- Surface: `/accounting/hoan-ung` (Báo cáo tổng hợp hoàn ứng,
  `OpsReconciliationReportPage`) + `/advances` tab "Phiếu hoàn ứng"
  (`AdminAdvanceSettlementsPage`), vai Kế toán.

## Bug (kết quả thực tế trước fix)

Báo cáo tính 'Còn phải hoàn ứng' ÂM (Nguyễn Huy Hoàng -420.000₫, Vũ Đình
Cường -4.300.000₫ — `outstandingSigned < 0`, needsCollection=true) nhưng KHÔNG
có lối vào thu hồi: nút per-row chỉ xuất hiện khi lọc đúng 1 đợt
(`actionLot`), dòng staff không lọc đợt không có nút; phiếu hoàn ứng hoàn
siêu âm (refundAmount âm, FB-100) chỉ ghi nhận ý định, KHÔNG di chuyển tiền.

## Luật tiền (đã đối chiếu source, không tự chế số)

- `outstandingSigned` (advance-shared.service `getSignedOutstandingAdvanceBalances`)
  = Σ RECORDED advanceRequests [min(amount, funded) − consumed] − Σ
  expense_cash_vouchers IN (FORWARDER, RECORDED). Một voucher IN mới giảm số
  dư đúng MỘT lần — kể cả khi không gắn đợt (reconciliationId NULL được đọc).
- Bút toán đối chiếu flow thu hồi đợt (`refundExpenseReconciliation`):
  ledger `OPS_SETTLEMENT` debit (FORWARDER/staff) + `treasury_movements` IN
  (quỹ đã phân nguồn, COMPANY) + `expense_cash_vouchers` RECORDED. Flow mới
  staff-level phải dùng đúng họ voucher này.
- Ngày 07/11 owner: KHÔNG dùng chữ "phê duyệt" — là "Xác nhận" nghiệp vụ trực
  tiếp của Kế toán.

## Case pin (expected sau thay đổi)

1. BE `POST /api/expense-accounting/advance-recovery` {opsUserId, amount,
   reason, treasuryAccountId, valueDate, physicalReference}:
   - staff có deficit D = |outstandingSigned| > 0 → amount ≤ D: ghi ledger
     OPS_SETTLEMENT debit=amount + movement IN amount + voucher RECORDED
     (FORWARDER/staff, reconciliationId NULL) — toàn bộ trong 1 tx, idempotent
     (Idempotency-Key), declareMaterialWrite.
   - amount > D → 409 nêu đúng số còn nắm; D ≤ 0 → 409; staff không phải OPS
     hoặc không active → 400.
   - amount < D cho phép (thu từng phần) — sau call, outstandingSigned tăng
     đúng amount (đọc lại authority), ví Ops giảm đúng amount.
2. FE Báo cáo hoàn ứng: dòng needsCollection && outstandingSigned < 0, vai
   ADMIN/ACCOUNTANT → nút "Xác nhận hoàn ứng" (mọi trạng thái lọc, không cần
   chọn đợt); dialog prefill amount = |outstandingSigned|, chọn quỹ + ngày
   giá trị + tham chiếu + lý do.
3. FE tab Phiếu hoàn ứng: phiếu RECORDED refundAmount < 0 → nút "Xác nhận
   hoàn ứng" prefill |refundAmount|, lý do cite số phiếu.
4. KHÔNG có chữ "phê duyệt" trong copy mới.

## Regression evidence

- (điền sau) BE scoped tests (deficit math pin bằng pure helper) + FE scoped
  tests, qa/2026-11-07-lane-k1/.

## Round 2 — QA fail 09/11 (staging build c4cea6b6, comment 4783) + fix r8a

**Fail thật:** `/advances` dialog chạy được (5.000.000₫ thu hồi qua phiếu),
nhưng `/accounting/hoan-ung` KHÔNG có nút trên dòng ÂM; bấm dòng không có gì
xảy ra.

**Root cause (staging data đã probe 09/11, hoapt):** cả 2 dòng QA có
`outstandingSigned = 0` (Nguyễn Huy Hoàng −420.000₫, Vũ Đình Cường −4.300.000₫
là `remainingSigned` — trục báo cáo, không phải trục ví). Nghiệp vụ đã tất toán
qua phiếu legacy `advance_settlements` (PT-2611-0004 +5.000.000₫ cho VĐC,
PT-2611-0005 và 5 phiếu nữa cho NHH) nên ví = 0, nhưng (a) báo cáo KHÔNG trừ
consumption của phiếu legacy vào ĐÃ ỨNG → âm ma giữ nguyên mãi; (b) nút per-row
điều kiện `outstandingSigned < 0` không bao giờ thỏa.

**Fix round 2:**
1. BE `ops-reconciliation-report.service`: ĐÃ ỨNG (nhánh không lọc đợt) trừ
   thêm consumption của phiếu legacy (advanceSettlementRequests ×
   advanceSettlements, loại VOIDED/REVERSED, floor ≥ 0) — báo cáo hội tụ về
   đúng số sổ sau khi phiếu post (đúng luật card 20260928_168). Sau fix, 2
   dòng QA đọc đúng trạng thái đã tất toán (không còn âm ma).
2. FE dòng ÂM `remainingSigned < 0` với ví đã về 0 → nút "Lập phiếu hoàn ứng"
   mở ĐÚNG dialog "Lập phiếu hoàn ứng" của tab /advances
   (`AdminAdvanceSettlementCreateDialog`), preselect đúng nhân viên của dòng
   (thêm prop `initialForwarderId`). Vai ADMIN/ACCOUNTANT (luật SIL-487);
   MANAGER chỉ đọc.
3. Dòng có deficit ví thật (`outstandingSigned < 0`) giữ nguyên đường drawer
   advance-recovery (Idempotency-Key) của round 1 — ưu tiên khi ví còn nắm âm.

**Pins:** BE `ops-reconciliation-report-netting.test.ts`; FE
`OpsReconciliationReportPage.test.tsx` (4 pins SIL-728: drawer deficit, dialog
âm-ví-0 prefill staff, dòng dương không nút, MANAGER không thấy nút).
