# Case: card 211026213838 — Ô số tiền Ops/phơi/tạm ứng chấp nhận số âm không báo lỗi

- Case ID: 2026-10-21-card211026213838
- Reported: 21/10/2026 21:38 (R31 batch, Ops/kế toán, local)
- Status: FIXED (branch fix-r31-kep-am)

## Reproduction (pre-fix)

1. Ops mở "Khai báo chi phí" (OpsExpenseFormModal) hoặc "Sửa khoản chi" (OpsExpenseEditModal): ô "Thực chi (VND)" là NumberField `grouped signed` → gõ `-` rồi số → -50.000 được nhận, Lưu thành công (mirrors backend `parseOpsMoney` signed — di sản card 20260928_197).
2. Phơi phiếu: "Chi tiết chi hộ" ô "Số tiền trả" và "Chi tiết tiền đường" ô "Thực chi hiện tại" đều `grouped signed` → nhập âm được.
3. BE chấp nhận: `parseOpsMoney` cho `-999..999..` (chỉ trừ 0); `/entries/:kind/:id/update` với `amount` âm qua `signedExpenseVndSchema`.

Expected (PRD OpsVanHanh bảng "Số tiền": "Số nguyên dương bằng đồng Việt Nam"; brief card 211026213838): mọi ô tiền chi Ops/phơi/tạm ứng validate min=0, số âm reject với message "Số tiền không được âm". Số âm chỉ hợp lệ nơi PRD định nghĩa (chiều số của báo cáo hoàn ứng — hiển thị, không phải ô nhập).

## Root cause

Card 20260928_197/181 cho phép số âm trên MỌI màn hình nhập chi phí ("(-) chi phí tương đương xóa dòng"). Card 211026213838 siết lại theo PRD cho cụm Ops chi phí + phơi + tạm ứng; các bề mặt kế toán (ExpenseEntryDrawer/ExpenseCreateDrawer) giữ nguyên semantics signed vừa land ở fix2 19/10 ("âm cảnh báo thu") — không thuộc sweep.

## Fix + regression pins

- FE: bỏ `signed` trên ô Thực chi của `OpsExpenseFormModal` / `OpsExpenseEditModal`, ô "Số tiền trả" của `PhoiPhieuChiHoDialog`, ô "Thực chi hiện tại" của `PhoiPhieuTienDuongDialog` (grouped unsigned loại dấu `-` ngay khi gõ); save-side guard + inline error "Số tiền không được âm" cho giá trị âm còn lại trong state (row lịch sử).
- BE: `parseOpsMoney` (ops-expenses.service.ts — endpoint Ops thuần, không xung đột contract kế toán) chặn số âm với 400 "Số tiền không được âm".
- Ô đã an toàn sẵn (verify, không đổi): `OpsAdvanceRequestModal` (grouped unsigned + amount > 0), `ExpenseCashDrawer` (min=1), `OpsLegacyExpenseEditModal` (grouped unsigned).

Pinned by `backend/src/tests/unit/ops-expense-money.test.ts` (parseOpsMoney: âm → 400 "Số tiền không được âm"; 0 → 400; biên 999.999.999.999.999 hợp lệ) và FE vitest của các form trên.
