# case-SIL-799 — Tab Thu nhập lái xe: trạng thái kỳ (tạm tính / đã chốt / đã trả)

## Repro (staging dc930964, 10/11)
/my-trips → tab/nav "Thu nhập" (/my-earnings): chỉ có tóm tắt kỳ hiện tại,
không có nhãn nào ghi tạm tính / kỳ đã chốt / đã trả; bộ chọn tháng không có
trạng thái kỳ.

## Expected (KB Ch4 §4.2.9)
Tab phân biệt: (1) TẠM TÍNH — kỳ đang mở; (2) ĐÃ CHỐT kế toán — số liệu chốt,
KHÔNG đồng nghĩa đã thanh toán; (3) ĐÃ TRẢ — đã tạm ứng/đã thanh toán.

## Fix
- Dòng trạng thái kỳ trong đầu thẻ "Tóm tắt kỳ này" (`[data-testid=period-state]`):
  LIVE → "Tạm tính — kỳ đang mở" · CONFIRMED → "Đã chốt kế toán — chưa đồng nghĩa
  đã thanh toán" · UNAVAILABLE → "Chưa có bản lương chốt — số liệu tham khảo".
- Mực trung tính (không xanh success — đã chốt ≠ đã nhận tiền, color law §2);
  dữ liệu từ wire có sẵn `salarySnapshotState` (driverFinanceClient.getEarnings).
- Khoản ĐÃ TRẢ giữ nguyên dòng "Đã tạm ứng/đã thanh toán" (sự kiện thực tế,
  không suy ra từ trạng thái chốt).

## Pins
DriverEarningsPage.test.tsx `SIL-799 — kỳ lương hiển thị trạng thái…` (4 it:
LIVE/CONFIRMED/UNAVAILABLE + tách dòng đã-trả; không class is-success).

## Coverage limit
Bộ chọn tháng chưa gắn trạng thái từng tháng (cần wire liệt kê trạng thái theo
tháng — ngoài phạm vi ticket); lịch sử kỳ đã chốt/đã trả xem /my-payslips (M8.6).
