# Case FB-104 (card 141026230810) — Chấm công: báo cáo Tổng hợp xếp lệnh tháng (mẫu Excel)

Nguồn: `.backlog-cards/141026230810-cham-cong-bao-cao-tong-hop-xep-lenh-thang.docx`
(wave W1 2026-10-16). Môi trường gốc: staging, mẫu Excel "TỔNG HỢP XẾP LỆNH
THÁNG 09/2026" (ảnh đính kèm của khách — ảnh không có trong card đọc được).

## Kỳ vọng (theo card)

- Mỗi dòng: STT, Loại xe, Biển kiểm soát, Hình thức lương, Lái xe.
- Lưới ký hiệu theo từng ngày trong tháng (1–30/31) với K/Q/Đ/L/N/P, phân biệt
  màu (xanh lá = lương chuyến, vàng = chủ nhật/nghỉ, đỏ = nghỉ).
- Dòng "Tổng lệnh kẹp/ngày" và tỷ lệ % theo ngày.
- Cột tổng hợp: Tổng lệnh đơn, Tổng lệnh kẹp, Số chuyến quay đầu, Tổng số
  chuyến, Số ngày công đi làm thực tế.
- Quy ước ký hiệu in kèm đầu báo cáo (bảng K/Q/Đ/L/P/N).

## Trạng thái — FB-104 đã sửa (trước đó KHÔNG tồn tại báo cáo này)

- Trang mới `/timesheet/bao-cao` — "Tổng hợp xếp lệnh tháng" (officeStaffOnly:
  ADMIN/MANAGER/ACCOUNTANT; nav Nhân sự + title map + pageCatalog).
- Bảng đúng mẫu: STT · Loại xe · Biển kiểm soát · Hình thức lương · Lái xe ·
  lưới ngày 1..31 (header số + thứ T2..CN) · Tổng lệnh đơn · Tổng lệnh kẹp ·
  Số chuyến quay đầu · Tổng số chuyến · Số ngày công; hai dòng chân bảng
  "Tổng lệnh kẹp/ngày" + "Tỷ lệ %"; quy ước ký hiệu K/Q/Đ/L/N/P in đầu báo cáo.
- Màu ô theo mô tả khách (ảnh mẫu chưa có — diễn giải ghi nhận ở đây):
  **xanh** = ô tạo chuyến tính lương chuyến (K/Q/Đ), **vàng** = Chủ nhật và lưu
  ca (ghi nhưng không tạo chuyến/ngày công), **đỏ** = nghỉ (N/P — đỏ thắng cả
  ô Chủ nhật). Chủ nhật dùng đúng cách đánh dấu tint nhạt của lưới chấm công.
- "Số chuyến quay đầu" đếm **CHUYẾN** (mỗi ô Q = 2 chuyến theo card 230790);
  "Tổng số chuyến" lấy số chuyến đã chốt của server (kèm chỉnh lệch); "Số ngày
  công" = ngày công thực tế (Chủ nhật không tính).
- "Tỷ lệ % theo ngày" = tổng lệnh kẹp / tổng lệnh (K+Q+Đ) của ngày.
- Nguồn dữ liệu: `GET /api/timesheet/months` (lưới ký hiệu theo lái xe) +
  `GET /api/timesheet/drivers` mở rộng thêm **Loại xe + Biển kiểm soát** của xe
  đang gán (`drivers.assigned_truck_id → trucks.vehicle_class/license_plate`).
