# Case FB-098 (card 141026230750) — lỗi "chưa có thông tin lô" khi kế toán khai chi phí lô hàng

Nguồn: `.backlog-cards/141026230750-ketoan-loi-chua-co-thong-tin-lo-khi-khai-chi-phi.docx`
(wave W1 2026-10-16). Môi trường gốc: staging, lô 215/265, 14/10 (hoapt).

## Tái hiện / kiểm chứng (trước sửa)

1. Chuỗi lỗi chính xác "chưa có thông tin lô" KHÔNG tồn tại trong mã hiện hành
   (đã tìm cả có/không dấu, mọi biến thể). Các chuỗi gần nhất:
   - `InvoiceTrackingFormModal.tsx` — "Đang tải thông tin lô — chờ danh sách
     chuyến rồi lưu lại." (guard khi submit lúc chi tiết lô/chuyến chưa tải xong).
   - `expense-accounting-create.service.ts` — "Không tìm thấy lô hàng." (khai
     chi phí mức lô khi lô không tồn tại / đã xóa / thiếu customerId).
   - `ShipmentDetailPage.tsx` — "Không tìm thấy lô hàng" (404 khi tải trang).
   → Nhiều khả năng khách gặp guard "Đang tải thông tin lô…" (submit sớm) hoặc
   bản staging cũ; không tái hiện được dòng lỗi nguyên văn trên build hiện tại.
2. Trang chi tiết lô KHÔNG có nút nào tên "khai chi phí" — chỉ có panel
   "Chi phí / thực thu" với nút "+ Thêm khoản chi" (từ card 20261005) — khách
   không tìm thấy/ không nhận ra lối vào khai chi phí trực tiếp của lô.

## Kỳ vọng (theo card)

(1) Vì sao khách gặp lỗi "chưa có thông tin lô" khi khai trực tiếp từ lô —
kiểm tra (bên trên); (2) bổ sung nút khai chi phí trên chi tiết lô để khớp thao
tác "ấn khai chi phí trực tiếp của lô hàng đó".

## Trạng thái — FB-098 đã sửa

- Nút **"Khai chi phí"** trên header chi tiết lô (cùng vai trò với panel:
  ADMIN/MANAGER/ACCOUNTANT, ẩn khi lô khóa kế toán) — mở drawer "Thêm khoản chi"
  dùng chung ở mức lô (`tripId: null`), lưu xong invalidate sổ chi phí của lô.
- Điều tra (1) ghi nhận như trên: không có chuỗi lỗi nguyên văn trong build hiện
  hành; guard "Đang tải thông tin lô…" là ứng viên gần nhất (hành vi giữ nguyên —
  submit sớm vẫn bị chặn đúng lúc tải dở).
