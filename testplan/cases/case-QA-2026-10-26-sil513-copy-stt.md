# Case: SIL-513 — Form tạo/sửa lô: Copy duy nhất ở cột STT (nhân bản row) + bỏ copy ở action column + bỏ chip copy-ALL + thu gọn TRỌNG LƯỢNG (KG)

- **Ticket:** SIL-513 (board id 575) — Owner 26/10, update comment 2026:
  (1) BỎ copy icon ở ACTION COLUMN (cạnh thùng rác); (2) BỎ chip "Copy giờ hẹn
  cho tất cả N cont" trong Lịch & ghi chú; (3) Copy CHỈ ở CỘT STT khi hover
  row (icon nhỏ CẠNH số STT) — click TẠO ROW MỚI copy toàn bộ giá trị dòng;
  (4) TRỌNG LƯỢNG (KG) thu gọn width.
- **Date:** 2026-10-26
- **Branch:** fix-508-cols (sau SIL-508 57b62b74 + SIL-512 78518d96)
- **Surface:** `ShipmentCreateWorkspace.tsx`, `ShipmentCreateContainerRow.tsx`,
  `shipment-create-model.ts`, `ClerkShipmentCreatePage.css`.

## Bug (trước)

1. Ô Ngày giờ đóng trả có sẵn nút clipboard copy (`CopyCodeButton` render ở
   actions slot mép phải của cell) — nằm cạnh thùng rác, nhìn như nút của
   action column.
2. Chip "Copy giờ hẹn cho tất cả N cont" trong Lịch & ghi chú (CUS-03) — thừa
   theo owner.
3. STT hover copy = copy GIỜ HẸN xuống các dòng trống — owner muốn nó NHÂN
   BẢN dòng ("handler đang chết" theo ngôn ngữ owner: click không tạo row).
4. TRỌNG LƯỢNG (KG) 144px rộng hơn floor header.

## Expected behavior (AC)

1. **Không còn** nút "Copy Giờ hẹn đóng trả" trong cell Ngày giờ đóng trả và
   không còn chip "Copy giờ hẹn cho tất cả N cont" (handler
   `applyAppointmentToAll` xóa). Feature "Áp dụng cho N container" (SIL-511)
   không thuộc ticket này — giữ nguyên.
2. **STT copy = duplicate**: icon 24px hiện cạnh số STT khi hover row (số STT
   KHÔNG bị ẩn/swap nữa); click → `duplicateContainerRow` chèn bản sao NGAY
   DƯỚI dòng nguồn với TOÀN BỘ giá trị (số cont, loại, nhà máy, tuyến, cảng,
   kg, giờ đóng/trả — owner liệt kê cont + loại: khác
   `createContainerFromPrevious` của "Thêm container" vốn để trống 2 trường
   đó) + toast "Đã nhân bản container N — kiểm tra số cont trước khi lưu".
   Clone KHÔNG bao giờ kế thừa `id` đã lưu (reconcile sẽ ghi đè sibling).
   ẩn khi `saving` (view mode) như Xóa container.
3. **TRỌNG LƯỢNG (KG)**: 144px → 140px = floor đo thật của header 1 dòng
   (FB-063: text 127px + 12px padding, live DOM); hẹp hơn là quyết định
   RÚT GỌN LABEL — để owner chốt (open question trong comment ticket).
4. "Copy giờ hẹn xuống cont trống" (section chip) + bulk "Áp dụng" giữ nguyên.

## Regression evidence

- Unit: `shipment-create-model.test.ts` (duplicateContainerRow full-clone +
  id undefined), `ShipmentCreateWorkspace.copy-appointment.test.tsx` viết lại
  (duplicate chèn ngay dưới đầy đủ giá trị / affordance luôn có trên mỗi
  dòng / chip copy-ALL retired / copy chỉ ở STT / copy-down section + bulk
  giữ contract cũ), view-mode test (không có Nhân bản khi saving).
- Rung-3: `qa/2026-10-26_sil513-copy-stt/` — driver (admin/Abc123): hover
  hiện icon (opacity 0→1, ordinal vẫn `visible`, icon x=284 cạnh ordinal
  right=282), click → 3 dòng, dòng 2 = clone ĐẦY ĐỦ (MSCU6639870 · 24.500 ·
  20/09/2026 09:00), dòng 3 nguyên vẹn, toast "Đã nhân bản container 1";
  copyInAppointmentCell=false, copyAllChipGone=true; weight header box 140 /
  text 127 (vừa 1 dòng). Screenshots hover-stt + duplicated.
