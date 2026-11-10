# SIL-777 (id 898) — Ops khai chi phí: bỏ bắt buộc ghi chú khi khoản chi không thu khách

- Ticket: SIL-777 (board SIL, id 898, tạo 09/11/2026; priority high).
- Nguồn: 2026.11.09.Ticket.docx, Phần I Nhóm A — "Bỏ bắt buộc chụp ảnh & ghi
  chú khi Ops khai phí". Frank 09/11/2026: "khách hàng bảo thế nào thì làm
  thế" — yêu cầu khách thắng.

## Quan hệ với SIL-723

SIL-723 (case-SIL-723-ops-expense-save-law.md) pin luật "dòng không thu khách
⇒ bắt buộc Ghi chú" (FE disable + server 400). Ticket này ĐẢO NGƯỢC luật đó
( KB Ch.2 §2.4.4 V16 cần cập nhật theo sau). Mọi pin SIL-723 liên quan Ghi chú
đã được viết lại theo luật mới; các pin khác (Số hóa đơn nhóm có hóa đơn, ảnh
tùy chọn, thông báo nêu tên trường) giữ nguyên.

## Case pin (expected sau thay đổi)

1. Tài khoản Ops mở popup "Khai báo chi phí": điền Loại phí + Số tiền, để
   trống Thực thu VÀ Ghi chú → nút Lưu MỞ; bấm Lưu lưu được khoản chi (không
   400, không thông báo "ghi chú bắt buộc" ở hàng dòng lẫn footer).
2. Điền đủ Ghi chú như trước vẫn lưu bình thường (payload `note` giữ nguyên).
3. Các luật còn lại không đổi: ảnh biên lai tùy chọn; nhóm có hóa đơn vẫn bắt
   buộc Số hóa đơn; thiếu trường bắt buộc → thông báo nêu tên trường.
4. Server: `createOpsExpense` không còn 400 "Dòng chi không thu khách hàng thì
   bắt buộc nhập ghi chú" (cổng đã xóa; client `draftErrors` bỏ nhánh tương
   ứng, hint dòng bị loại).

## Regression evidence

- FE `OpsExpenseFormModal.containers.test.tsx` B2 viết lại: dòng không thu
  khách KHÔNG có Ghi chú → Lưu mở, không gate notice; có Ghi chú vẫn lưu.
- FE `OpsOrdersPage.test.tsx` 2 test viết lại (money-input test không còn điền
  Ghi chú; upload test pin "không có gate notice, Lưu chờ duy nhất upload").
- QA probe tích hợp `qa/scripts/lane-g1-ui-drive.mjs` (@390): Lưu BẬT khi
  thiếu Ghi chú + không notice → `sil-777_ui-4-note-optional-save-390.png`.
- Unit BE: cổng xóa (không pin text âm); hành vi lưu-thiếu-ghi-chú do QA probe
  tích hợp bảo vệ (unit BE cấm boot db/app).
