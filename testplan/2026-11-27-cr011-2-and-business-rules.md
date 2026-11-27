# Spec & Regression Cases — CR-011.2 Hotfix & Business Rules (2026-11-27)

Sources:
- `Ticket_Hotfix_CR-011.2_SilverSea_20261127.docx` (HOT-01..07, DOC-01)
- `Giai-dap-quy-tac-nghiep-vu-Dev-2026-11-27.docx` (8 business rules)

## Cases

### HOT-01 — `/shipments/new` form polish & required markers
- Footer buttons render plain `'Huỷ'`, `'Lưu nháp'`, `'Tạo lô hàng'` (no `'(cuối trang)'` in visible text).
- `CẢNG NÂNG` cell has uniform white surface (no abnormal grey background).
- Required fields in `Thông tin hàng` carry red `*` (`LOẠI *`, `NHÀ MÁY *`, `TUYẾN ĐƯỜNG *`, `CẢNG NÂNG *`, `CẢNG HẠ *`, `NGÀY GIỜ ĐÓNG TRẢ *`) matching `Bắt buộc: x/9`.
- `TUYẾN ĐƯỜNG` shows readonly `'Theo nhà máy'` when `Lệnh chạy ngoài` is off and factory route is auto-locked.
- Add-container count input has `SL` label/tooltip; STT + Copy icon have spacing + tooltip; trailing empty action column hides when 1 row.

### HOT-02 — `/shipments/:id` footer actions
- Footer renders `[← Quay lại]`, `[Sửa lô hàng]` (to `/shipments/:id/edit`, disabled with tooltip `'Lô hàng đã khóa kế toán; không thể sửa.'` when accounting-locked), `[+ Tạo lô mới]` (to `/shipments/new`) for CUS/MANAGER/ADMIN; hidden for DISPATCHER/OPS/ACCOUNTANT.

### HOT-03 — `/dispatch-detail` SilverSea `Chờ chọn xe` & merged external `Chờ bổ sung biển`
- Lots allocated to `SilverSea` (`OWN`) without plate display `'SilverSea'` + `'Chờ chọn xe'` (never `'Chưa phân xe'`), with Phát lệnh kept locked.
- External carrier rows without plate display ONE `'Chờ bổ sung biển'` line (no duplicate `'Chờ biển'` + `'• Chờ bổ sung biển'`).

### HOT-04 — `/dispatch-detail` in-place `[+ Gán xe]` quick assign
- Clicking `[+ Gán xe]` toggles in-place checkbox selection mode instead of navigating to `/dispatch`.
- Selecting ≥1 row shows floating bar `[Gán nhà xe cho N dòng đã chọn]` → popup to pick `SilverSea (Xe nhà)` or external carrier (+ optional plate) → saves and syncs back to `/dispatch`.

### HOT-05 — `/advances` `Báo cáo hoàn ứng` includes all non-zero signed balances
- Unfiltered `listMonthlyReconciliationReport` includes staff whose `canonicalSignedMap` balance is non-zero (e.g. `Lưu Danh Hùng -777.000 đ`) even when monthly `dntt`/`advanced`/`advancedRecorded` are 0, so `totals.remainingSigned` matches KPI `TỒN TẠM ỨNG` and Modal `Lập phiếu hoàn ứng` 100%.

### HOT-06 — Driver `/my-trips/:id` Soft Notice above `Tiến độ chuyến`
- Yellow Soft Notice (`Lưu ý: Bạn đang có N chuyến khác chưa hoàn tất...`) renders above `Tiến độ chuyến` and scroll body keeps ≥80px clearance above sticky `[Nhận lệnh vận chuyển]` at 390×844.

### HOT-07 — Ops `/ops/orders` `OpsExpenseFormModal` delayed amount validation
- Selecting a fee type without touching amount or clicking `[Lưu]` does NOT display `'Nhập số tiền nguyên, tối đa ...'`; error appears only after amount interaction/blur or submit attempt.

### Business Rule 5 — `"Đủ điều kiện"` status color
- `RecoverableCostsWorkspace` renders `ELIGIBLE` (`Đủ điều kiện lập Giấy báo nợ`) with `'info'` (teal/blue), never `'success'` (green).

### DOC-01 — Wiki Folio MCP sync (`space: silversea`)
- Update Chương 3, 4, 6, 8, 10 and `business-logic-changelog.md` on Folio MCP with CR-011 / CR-011.1 / CR-011.2 and the 8 business rules.
