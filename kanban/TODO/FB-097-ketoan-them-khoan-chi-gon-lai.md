# FB-097: Kế toán — gọn form "Thêm khoản chi" + logic bên thực chi
**Nguồn:** card `141026230740-ketoan-them-khoan-chi-gon-lai.docx` (wave W1) +
TC-COSTUX-03/04 (`testplan/2026-10-14-cost-ux-accounting-five-features.md`)
**Ưu tiên:** P3
- Nhóm chi phí: chỉ "Tiền đường" / "Chi phí lô hàng"
- "Nhà cung cấp" tự điền = nhà xe đang chạy chuyến (khớp NCC theo id, dự phòng
  tên; không có nhà xe ngoài → chọn tay)
- Cặp "Số hóa đơn / Ngày hóa đơn" hiển thị sẵn, tùy chọn
- Bỏ "Ghi chú khoản chi" + ô "Loại chứng từ" (hợp đồng lưu không ghi); giữ
  "Loại phí" + "Ngày chi"
- Lưu liên tục: drawer không đóng, trống ô của khoản, giữ nhóm/bên thực chi/
  ngày; trạng thái "Đã lưu khoản chi."; "Đóng" kết thúc phiên
