# SIL-870 round 2 — SỐ HĐ 'unc' thay vì 'X' trên 2 dòng phí không hóa đơn

## Case — placeholder 'unc' còn lộ lên cột SỐ HĐ

- **Repro (QA verbatim, build 32e22c12, role hoapt, verdict 19:50 SGT):**
  /advances → tab 'Chi phí Ops' → quét full bảng 45 rows (29 'X', 14 số HĐ
  thật, 2 'unc'). 2 dòng vẫn 'unc' thay vì 'X':
  - 13/11/2026 · ZIMUHAI80262535 · 'Phí kết cấu hạ tầng' · 500.000₫
  - 12/11/2026 · TWNSFA000519 · 'Phí kết cấu hạ tầng' · 500.000₫
- **Root cause (chứng minh bằng source + local DB):** 'unc' KHÔNG phải nhánh
  classify miss — là dữ liệu DB thật: user Ops gõ placeholder vào ô "Số hóa
  đơn (Tùy chọn)" (optional từ SIL-834), writer "thêm khoản chi" mức lô
  (`expense-accounting-create.service.ts` → `ops_expense_entries.invoice_number`)
  lưu nguyên text. FE law `row.invoiceNumber?.trim() || 'X'` chỉ bắt
  null/rỗng nên render đúng những gì DB giữ.
- **Expected:** 100% dòng phí không hóa đơn hiện 'X' ở SỐ HĐ. Luật chung:
  số hóa đơn thật luôn mang chữ số (dãy số bắt buộc của hóa đơn); giá trị
  không có chữ số nào ('unc', 'chưa có', 'x'…) = placeholder → classify là
  KHÔNG có hóa đơn → render 'X'.
- **Fix:** classifier thuần `effectiveOpsInvoiceNumber` (leaf module
  `backend/src/services/ops-invoice-number.ts`): digitless → null. Áp ở
  4 mặt: read board (`listOpsExpenses`), read legacy TRIP rows
  (`listLegacyOpsExpenseHistory`), write Ops (`createOpsExpense`/
  `updateOpsExpense`), write trip-lane (`createAccountingExpense` +
  `createShipmentLevelAccountingExpense`). FE giữ nguyên cell law.
- **Regression pins:** `backend/src/tests/ops-invoice-number.test.ts`
  (3 test: đúng 2 dòng repro QA + các biến thể placeholder + số HĐ thật
  giữ nguyên trimmed).
- **Không đổi:** phân nhóm tiền quyết toán A/B bucket theo
  `requiresInvoice` (flag catalog), không theo invoiceNumber → không dịch
  chuyển tiền khi 'unc' thành null.
