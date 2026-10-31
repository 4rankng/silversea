# SIL-637 (id 741) — Form tạo lô: bỏ nhãn «Ngày giờ đóng trả *» trên band đầu form

## Case ID
SIL-637-BAND-LABEL-RETIRE

## Bug (staging 31/10, ảnh đính kèm ticket)
Band đầu form Tạo lô hàng (cụm Loại hàng + ô DD/MM/YYYY + HH:mm): chế độ HÀNG
LẺ (LCL) vẫn render dòng nhãn «Ngày giờ đóng trả *» phía trên 2 ô nhập —
trường `UDateTimeField id="shipment-lcl-closing-at"` với `label` +
`requiredMark` (span `split-datetime__label`).

Xác nhận câu hỏi trong ticket ("nhãn riêng hay phần còn lại của fix 625?"):
đây là nhãn RIÊNG của trường LCL — fix SIL-625 (id 729) đã bỏ nhãn
«Ngày giờ đóng trả cho tất cả cont» của trường FCL bulk (hideLabel), không
dính trường này.

## Expected (owner)
- BỎ CHỈ nhãn visible «Ngày giờ đóng trả *» (thêm `hideLabel` — cùng pattern
  SIL-625). Nhãn vẫn sống trong `aria-label` của group `[data-split-datetime]`
  cho screen reader.
- GIỮ nguyên: 2 ô nhập ngày/giờ, validation bắt buộc (submit block + paint,
  model `shipment-create-model` §lclClosingAt không đổi), combined picker copy.
- Nút Copy-all của FCL bulk không đổi.

## Tests cập nhật
- `ShipmentCreateWorkspace.lcl-visible.test.tsx` (LCL-04): label visible →
  aria-label contract.
- `ShipmentCreateWorkspace.asterisk-contract.test.tsx`: bỏ expect '*' visible
  trên `shipment-lcl-closing-at` (owner ruling: band field không còn mark);
  các trường LCL khác giữ mark; rename test SIL-587 label → SIL-637.
- `ShipmentCreateWorkspace.sil616-617-625-band.test.tsx`: thêm pin SIL-637 —
  LCL band label retired như FCL (queryByText null + aria-label present).

## Repro / verify
- Mở /shipments/new (CUS) → click «Hàng lẻ» → band đầu: KHÔNG còn dòng
  «Ngày giờ đóng trả *»; ô nhập vẫn ở đó; submit trống vẫn bị chặn với issue
  của trường này; aria-label group = «Ngày giờ đóng trả».
- Chế độ FCL: band Copy-all như cũ (SIL-625/617 regression pins giữ nguyên).
