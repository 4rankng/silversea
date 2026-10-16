# FB-103: Chấm công — 2 chế độ lương lái xe (theo chuyến / theo tháng)
**Nguồn:** card `141026230800-cham-cong-che-do-luong-lai-xe.docx` (wave W1)
**Ưu tiên:** P3
- PER_TRIP (không trốn vé): 300k/chuyến + lương ngày theo ngày công; chuyến 21+
  +100k — công thức đã có sẵn (shared), giữ nguyên
- FLAT_MONTHLY (trốn vé): lương cứng/tháng (VD 10.000.000đ nếu đủ công)
- UI ghi nhận/chọn hình thức lương (trước không có): dialog "Mở bảng chấm
  công" (mode + Lương ngày / Lương tháng cố định), panel "Chế độ lương" ở bàn
  đối chiếu (PATCH mode), cột "Hình thức lương" ở Tổng hợp tháng, readout ở
  lưới Điều vận
