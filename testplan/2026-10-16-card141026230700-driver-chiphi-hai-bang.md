# Card 141026230700 — Lái xe: thiết kế lại 2 bảng chi phí khi kết thúc lô hàng

Nguồn: kanban TODO `141026230700-driver-chi-phi-lo-hang-tien-duong-redesign.docx`
(Google Drive original, đọc được 2026-10-16; trước đó bản 0-byte).
Mức độ P3, ngày 2026-10-14, môi trường staging.

## Yêu cầu (theo card) → hiện trạng main (e717d2cb)

| # | Yêu cầu card | Hiện trạng | Việc |
|---|---|---|---|
| 1 | 2 bảng "Chi phí lô hàng" / "Tiền đường" khi kết thúc lô | 1 danh sách gộp "Chi phí lô hàng & tiền đường", nhóm chỉ là nhãn từng dòng (và Tabs trong draft) | Tách 2 bảng hiển thị, luôn hiện cả hai |
| 2 | BỎ chọn người chi (TÔI CHI / CÔNG TY CHI GIÚP EM) | Đã có từ card 20261005 (payerKind gỡ khỏi draft + payload + DB) | Không đổi |
| 3a | Bảng Chi phí lô hàng: bỏ số hóa đơn + ngày hóa đơn | Số/Ngày hóa đơn hiện khi "Loại chứng từ = Hóa đơn" | Gỡ 2 trường này khỏi màn lái xe; payload lái xe không gửi nữa |
| 3b | Thêm 2 ô chọn nhỏ: Hóa đơn / Phiếu thu | Đang là select "Loại chứng từ" | Đổi thành cặp nút chọn nhỏ (≤40px, token nhà) |
| 3c | Yêu cầu chụp biên lai khi có chi phí lô hàng | Bắt buộc ảnh chỉ với Phiếu thu / mã phí bắt buộc chứng từ | Mở rộng: MỌI dòng nhóm DRIVER_SHIPMENT phải có ảnh biên lai (FE chặn + BE từ chối) |
| 4a | Tiền đường: hệ thống tự ghi, lái xe chỉ được nhìn | Đã khóa (card 20261005): ROAD_ALLOWANCE/LIFT_DROP_ZONE lái xe không tạo được (400), dòng đã lưu không nút sửa | Không đổi luật; đưa vào bảng "Tiền đường" |
| 4b | Nâng/Hạ Lạch Huyện: hệ thống tự cộng | Như trên (LIFT_DROP_ZONE) | Không đổi |
| 4c | Loại chi phí khác: lái xe chọn loại + điền tiền | Giữ nguyên | Gỡ option chết 'Tiền tuyến đã thỏa thuận' (ROAD_ALLOWANCE — BE đã chặn từ 20261005, chọn chỉ ra 400) |
| 5 | Thêm chi phí liên tục không cần lưu từng dòng | Đã có (bảng draft + "Lưu tất cả") | Không đổi |

## Thay đổi hợp đồng (owner-facing)

- Card 20260921_6/20260928_163 đặt luật "phí có hóa đơn PHẢI kèm số hóa đơn" cho
  đường ghi lái xe. Card này (14/10, mới hơn) bỏ trường số/ngày HĐ khỏi màn lái xe:
  ảnh biên lai là chứng từ, kế toán đọc số trên ảnh ở màn phơi phiếu. Trên ĐƯỜNG
  GHI LÁI XE: loại có hóa đơn không còn bắt buộc số HĐ gõ tay; chiều thu khách
  (customerChargeAmount = số tiền) giữ nguyên. Caller cũ (offline queue) vẫn gửi
  được số HĐ — lưu như trước.

## Case hồi quy

### CP700-01 — 2 bảng luôn hiện, đúng nhóm
1. Mở `/my-trips/:id` (lái xe, chuyến đang chạy) phần chi phí.
2. Luôn thấy 2 tiêu đề bảng: "Chi phí lô hàng" và "Tiền đường", kể cả khi trống
   ("Chưa có chi phí lô hàng phát sinh" / "Chưa có tiền đường phát sinh").
3. Dòng cũ thiếu costGroup phân theo costType (TOLL/PARKING/PER_DIEM → Tiền
   đường, còn lại → Chi phí lô hàng) — trùng fallback BE.

### CP700-02 — dòng lô hàng: 2 ô chọn nhỏ, không còn Số/Ngày hóa đơn
1. "Thêm chi phí" → tab "Chi phí lô hàng", chọn loại phí.
2. Thấy cặp ô chọn nhỏ "Hóa đơn" / "Phiếu thu" (không còn select "Loại chứng từ"
   dạng dropdown); KHÔNG có trường "Số hóa đơn"/"Ngày hóa đơn" nào.
3. Payload: lot cost mang `evidenceKind`, không bao giờ mang `invoiceNumber`/
   `invoiceDate`.

### CP700-03 — biên lai bắt buộc với mọi dòng lô hàng
1. Nhập dòng nhóm "Chi phí lô hàng" chưa chụp ảnh → nút Lưu khóa + nhắc
   "Chi phí lô hàng phải kèm ảnh biên lai trước khi lưu." (testid
   `shipment-cost-receipt-required`).
2. Chụp ảnh → Lưu mở. Dòng nhóm "Tiền đường" thường (không mã bắt buộc chứng
   từ) không bị bắt ảnh.
3. BE: POST driver incidental cost nhóm DRIVER_SHIPMENT không có
   `receiptStorageKey` → 400 "Chi phí lô hàng phải kèm ảnh biên lai trước khi
   lưu."; nhóm DRIVER_ROAD không đổi.

### CP700-04 — loại có hóa đơn không cần số HĐ tay (đường ghi lái xe)
1. BE: FEE_CLEANING (requires_invoice) KHÔNG số HĐ, CÓ ảnh → 201/ok;
   `customerChargeAmount` = số tiền, `invoiceNumber` NULL.
2. Caller gửi kèm số HĐ (offline) → số lưu như trước.
3. Đường kế toán (createAccountingExpense) không đổi.

### CP700-05 — gỡ option 'Tiền tuyến đã thỏa thuận'
1. Danh sách loại phí nhóm "Tiền đường" không còn "Tiền tuyến đã thỏa thuận"
   (BE chặn ROAD_ALLOWANCE từ 20261005 — chọn chỉ ra 400).
2. Định mức (Trả đêm/Lưu ca/…) giữ nguyên.

## Gate

- FE: `npx tsc -b` = 0; vitest scoped: `ShipmentCostEntryForm.test.tsx`,
  `ShipmentCostEntryDraft.test.tsx` (đã cập nhật hợp đồng mới).
- BE: `pnpm exec tsc --noEmit` = 0; `pnpm exec tsx --test` trên
  `card6-driver-lot-cost-classification.test.ts`,
  `card164-driver-no-invoice-lot-cost.test.ts`, `m84-incidental-cost.test.ts`.

## Provenance UI

Dùng primitive nhà có sẵn (btn sm + token, TabsDraft hiện có); không layout mới
— không cần tra catalog Untitled UI/Tailkit cho thay đổi này (đổi control trong
form đã tồn tại, không tạo page/mẫu mới).
