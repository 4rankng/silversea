# Case FB-097 (card 141026230740) — Kế toán: gọn form "Thêm khoản chi" + logic bên thực chi

Nguồn: `.backlog-cards/141026230740-ketoan-them-khoan-chi-gon-lai.docx`
(wave W1 2026-10-16) + hợp đồng chi tiết `testplan/2026-10-14-cost-ux-accounting-five-features.md`
TC-COSTUX-03 / TC-COSTUX-04. Môi trường gốc: staging, 14/10.

## Tái hiện (trước sửa)

Kiểm soát phơi phiếu → Chi tiết tiền đường / chi hộ → "＋ Thêm dòng" → drawer
"Thêm khoản chi":

1. Cặp "Số hóa đơn / Ngày hóa đơn" bị ẩn sau "Loại chứng từ = Hóa đơn" (mặc định
   Phiếu thu → không thấy ô hóa đơn để điền tùy chọn).
2. Chọn "Nhà cung cấp" không tự điền nhà xe chạy chuyến: code cũ so
   `catalog.carriers.routeName` với Số Booking/Bill (sai ngữ nghĩa, không bao
   giờ khớp — QA 2026-10-15 xác nhận luôn trống).
3. Vẫn còn ô "Ghi chú khoản chi" (form chưa gọn).
4. Lưu 1 khoản → drawer đóng ngay, không nhập liên tục được; không có dòng
   trạng thái xác nhận.

## Kỳ vọng (theo card + TC-COSTUX-03/04)

- Nhóm chi phí chỉ "Tiền đường" / "Chi phí lô hàng" (đã đúng từ trước).
- Chọn "Nhà cung cấp" → mặc định nhà xe đang chạy chuyến (trip
  `carrierType='EXTERNAL', externalEntityType='SUPPLIER'` → khớp danh mục
  suppliers theo id, dự phòng theo tên); không có nhà xe ngoài → chọn tay.
- Cặp "Số hóa đơn / Ngày hóa đơn" hiển thị sẵn, tùy chọn.
- Form gọn: không còn "Ghi chú khoản chi"; "Loại phí" và "Ngày chi" ở lại
  (hợp đồng lưu `expenseAccountingCreateSchema` bắt buộc).
- Lưu thành công → drawer KHÔNG đóng; ô của khoản làm trống; nhóm chi phí /
  bên thực chi / ngày giữ nguyên; dòng trạng thái "Đã lưu khoản chi."; nút
  "Đóng" kết thúc phiên.

## Trạng thái — FB-097 đã sửa

- `ExpenseCreateDrawer.tsx`: bỏ "Ghi chú khoản chi" + ô "Loại chứng từ" (không
  nằm trong hợp đồng lưu); cặp hóa đơn luôn hiện, tùy chọn (gửi `null` khi để
  trống); tự điền NCC theo `carrier` (id trước, tên sau — nguồn
  `trip_carrier_info` của chuyến, kèm trên dòng phơi phiếu); lưu liên tục +
  "Đã lưu khoản chi."; key idempotent tạo mới sau mỗi lần lưu thành công (trùng
  nội dung vẫn ghi được khoản mới), giữ nguyên khi lưu lỗi → thử lại.
- `ExpenseEvidenceFields.tsx`: thêm biến thể `invoice-pair` cho màn kế toán;
  biến thể `kind-picker` của màn lái xe giữ nguyên (payload lái xe có
  `evidenceKind` + quy tắc ảnh).
- `phoi-phieu-control.service.ts` + `phoiPhieuClient.ts` + 2 dialog + trang
  Kiểm soát phơi phiếu: dòng phơi phiếu mang `carrierSupplierId` (id NCC nhà
  xe của chuyến) cho form tự điền.
