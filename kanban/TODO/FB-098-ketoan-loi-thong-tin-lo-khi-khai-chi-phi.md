# FB-098: Kế toán — lỗi "chưa có thông tin lô" + nút khai chi phí trên chi tiết lô
**Nguồn:** card `141026230750-ketoan-loi-chua-co-thong-tin-lo-khi-khai-chi-phi.docx`
(wave W1)
**Ưu tiên:** P2
- Điều tra lỗi "chưa có thông tin lô": chuỗi không tồn tại trong build hiện
  hành; gần nhất là guard "Đang tải thông tin lô…" (submit khi chi tiết lô/chưa
  tải xong) — ghi nhận trong testplan
- Bổ sung nút "Khai chi phí" trên chi tiết lô (ADMIN/MANAGER/ACCOUNTANT, ẩn khi
  khóa kế toán) → mở drawer "Thêm khoản chi" dùng chung ở mức lô
