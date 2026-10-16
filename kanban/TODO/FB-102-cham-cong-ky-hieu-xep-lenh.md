# FB-102: Chấm công — ký hiệu xếp lệnh K/Q/Đ/L/N/P + mở bảng tháng
**Nguồn:** card `141026230790-cham-cong-ky-hieu-xep-lenh.docx` (wave W1)
**Ưu tiên:** P3
- K=1 chuyến, Q=2, Đ=1, L=0 (vẫn 1 ngày công), N=0/0, P=0 chuyến + 1 ngày công;
  Chủ nhật ghi chuyến, không tính ngày công — đã có từ wave D, pin bằng test
  shared/backend/frontend
- Sửa khoảng trống: tháng mới chưa có bảng thì không nhập được — thêm nút
  "Mở bảng chấm công" cho kế toán (POST /months accountantOnly) tại lưới;
  Điều vận không thấy nút (đúng phân quyền)
