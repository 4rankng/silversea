# SIL-841 (id 970) — round 17/11: legend per-screen + cột 'Ngày làm CN' trên Đối chiếu

- **Ticket**: SIL-841 · URGENT · QA FAIL 16/11 23:12 build dd198999 — hồi quy legend so với PASS 5442 trên 68646e82 (fix 68646e82 là ancestor của dd198999 → hồi quy thật). Phần ĐẠT (Q=2 chuyến, CN chỉ tính chuyến, /salary khớp Đối chiếu) KHÔNG đụng.

## Ba điểm còn fail + fix

1. **/timesheet/doi-chieu không có legend**: thêm `<p class="ts-legend">` trong Panel 'Tổng hợp tháng' — 6 ký hiệu K/Q/Đ/L/N/P đọc `TIMESHEET_SYMBOL_RULES` (label + summaryTrips + workdayNote: 'L Lưu ca (0 chuyến · +ngày công)', 'N … −1 ngày phép (sau ngày đầu)', 'P … +ngày công', 'Q Quay đầu (2 chuyến)') + dòng 'Chủ nhật — nền vàng, ghi chuyến, không tính ngày công'. `.ts-legend` ride `TimesheetGridPage.css` mà trang đã import — không css mới.
2. **/timesheet thiếu dòng Chủ nhật**: thêm dòng 'Chủ nhật — nền vàng, ghi chuyến, không tính ngày công' vào legend (trước đó chỉ trong tooltip ô — TimesheetGrid.tsx titleParts).
3. **Đối chiếu 'CHUYẾN CN' → 'NGÀY LÀM CN'**: literal thật là 'Chuyến CN' (th + data-label, CSS uppercase hóa thành 'CHUYẾN CN' — orchestrator không tìm thấy vì sai hoa/thường); đổi cả th + data-label thành 'Ngày làm CN', giữ nguyên binding `row.sundayTrips` (đúng quan sát 5442 trên 68646e82).

## Pins (giữ luật — thêm assertion, không xóa)

- `TimesheetReconciliationPage.test.tsx`: legend đầy đủ trên Đối chiếu (Q/L/N/P + Chủ nhật) + cột th 'Ngày làm CN' + Sunday row marker.
- `TimesheetGridPage.test.tsx`: dòng 'Chủ nhật — nền vàng…' là legend line trên /timesheet.
- Không assertion nào bị xóa; test 'Chuyến CN' cũ không tồn tại (chưa từng có pin stale).

## Gates

- FE scoped vitest: TimesheetReconciliationPage + TimesheetGridPage + TimesheetMonthlyReportPage **39/39 PASS** · FE `tsc -b` sạch.
- Build mới cho QA: orchestrator harvest từ commit lane này (staging đang 0fcc040b — cần deploy mới trước khi re-test).
