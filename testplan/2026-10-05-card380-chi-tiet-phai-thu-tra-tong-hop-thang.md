# Card 380 — Hồi quy: Chi tiết phải thu/trả — bảng tổng hợp sản lượng theo tháng

Ngày: 2026-10-05 · REQ-5.10-12 · impl-380 (Agent-ZAI)

## Phạm vi hồi quy (Regression profile — trước khi làm)

| # | Khu vực | Rủi ro hồi quy | Trường hợp kiểm |
|---|---|---|---|
| R1 | Bảng ledger hiện có trên `/debt` + `/payables` | Section mới đè lên bảng chính / phá pagination, sort, filter cũ | Bảng chính giữ nguyên mọi cột + hành vi; section tổng hợp nằm DƯỚI bảng (kiểm: DebtListPage.filters, PayableListPage sort/filter test cũ vẫn xanh) |
| R2 | Cột "Còn nợ" | lệch số với sổ công nợ hiện có | Test chốt: `data-label="Còn nợ"` của section = `data-label="Tổng nợ"` của bảng chính cùng khách hàng/NCC (DebtListPage.filters.test.tsx, PayableListPage.test.tsx, PartyMonthlyProductionSummary.test.tsx) |
| R3 | Tổng hợp tháng (tiền + VAT) | tự tổng lại ngoài endpoint | Tổng SL/cước/đã thanh toán/tồn cuối kỳ lấy từ `grand` của báo cáo kỳ phôi phiếu (không tổng lại song song); còn nợ tổng bằng round2dp; VAT hiển thị `—` kèm ghi chú gap |
| R4 | Đơn vị tiền | định dạng tiền lệch chuẩn | mọi ô tiền qua `formatCurrency` + `round2dp` của shared |
| R5 | Vai trò | role không đủ thấy lỗi 403 thay vì ẩn section | section chỉ render cho ADMIN/MANAGER/ACCOUNTANT (cùng requireRoles của endpoint báo cáo kỳ) |
| R6 | Tiến trình trang khi role thường | section fetch khi không được phép | `enabled: allowed` — không fetch khi role không đủ |
| R7 | Màn hẹp ≤640px | ma trận tiền rộng tràn màn hình | scroll box + min-width từng cột theo luật 2026-09-29; không nowrap header |
| R8 | Trang kiểm soát phôi phiếu | section mới tham chiếu nhầm file đang sửa | component không import bất kỳ file PhoiPhieuControlPage* nào |

## Đầu đã chốt (documented defaults — Cần chốt với khách hàng vẫn mở)

1. "Số ĐNTT" = chưa có nguồn dữ liệu theo bên trong kỳ chạm được từ 2 trang này → hiển thị `—` (gap có tên trong DEV NOTE).
2. "% THUẾ - HD - SỐ CT/NGÀY" = ba giá trị riêng theo spec, nhưng chưa có dữ liệu hóa đơn/VAT theo bên trong kỳ → `—`.
3. Tháng = tháng lịch của bộ lọc Từ ngày/Đến ngày, mặc định tháng hiện tại (01 → cuối tháng).
4. "ĐÃ THANH TOÁN" = tiền đã ghi của phía chính theo variant (phải thu trên /debt, phải trả trên /payables).
5. "Tồn cuối kỳ" (Phải thu/Phải trả) = `conLai` của báo cáo kỳ tương ứng; "Còn nợ" = số outstanding hiện hữu trên chính trang (khớp theo tên bên).
6. Bên vắng mặt trên sổ công nợ (số dư ≤ 0) hiển thị còn nợ `0 ₫` — không còn phải xử lý.

## Hàm kiểm đã chạy (evidence)

- `cd frontend && pnpm exec tsc -b` → 0 errors.
- `vitest run PartyMonthlyProductionSummary.test.tsx DebtListPage.filters.test.tsx PayableListPage.test.tsx DebtListPage.sort.test.tsx debt-payable-aging.test.tsx` → 24/24 pass.
- `pnpm lint` → kết quả ghi tại báo cáo lane.
