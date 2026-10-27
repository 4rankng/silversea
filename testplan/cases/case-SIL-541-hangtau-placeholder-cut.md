# SIL-541 — Form tạo lô: placeholder 'Hãng tàu' bị cắt chữ

- Ticket: SIL-541 (board SIL, id 607) — QA Glint 27/10.
- Surface: `/shipments/new` (ClerkShipmentCreatePage) — band Nhận diện lô,
  field Hãng tàu (UUI ComboBox, chỉ hiện khi FCL).

## Báo cáo

"Nhìn field Hãng tàu. Actual: placeholder hiện 'Gõ chọn hoặc nhập hãng tì'
— bị cắt giữa chữ do hẹp input. Expected: hiện đủ placeholder hoặc ellipsis
gọn."

## Root cause

Placeholder render từ `<input>` native trong `ComboBox` (lớp chữ trong suốt
đè lên ghost value). Input không có treatment tràn → `text-overflow: clip`
mặc định của native input: chữ placeholder dài hơn ô bị cắt NGAY GIỮA CHỮ,
không có dấu hiệu "còn tiếp". Đo thật 28/10 @1440 (trước fix): input 154px,
chữ placeholder 168.4px → cắt tại 'hãng tì'.

## Fix (shared owner — một luật cho cả lớp lỗi)

- `combobox.tsx` — AriaInput thêm `text-ellipsis`: placeholder tràn ends
  clean '…'. (Ghost value đã có `truncate` từ trước — giờ được pin test.)
- `input.tsx` — Input base cùng luật `text-ellipsis` (placeholder lẫn value
  tràn ô → ellipsis; hành vi caret/sửa chữ không đổi). Sweep sibling: mọi
  UUI input khác (Bill/Booking, Tiền cược dự kiến,…) hết lớp cắt-giữa-chữ.

## Case pin (expected sau thay đổi)

1. @1440/1280 (input 154–162px < chữ 168.4px): placeholder hiện
   'Gõ chọn hoặc nhập hån…' — ellipsis sạch, KHÔNG cắt giữa chữ.
2. @1024 (input 367.5px): placeholder hiện ĐỦ — không ellipsis.
3. Value đã chọn dài hơn ô: ghost value ellipsis (truncate) — không đổi.
4. Sibling: mọi Input/ComboBox UUI khác có cùng treatment (class
   `text-ellipsis` trên input native).

## Regression lock

- `combobox.test.tsx` — pin `text-ellipsis` trên input native + `truncate`
  trên ghost value (SIL-541 test).
- `input.test.tsx` — pin `text-ellipsis` trên Input base.

## Gates

- Scoped vitest: untitled-ui + design-system/forms + features/shipments +
  ShipmentsPage + clerk (105 file / 1105 test) + styles/design-system sweep
  (416 test) — pass.
- tsgo --noEmit — 0.
- Rung 3 driver `qa/scripts/2026-10-28-sil541-hangtau-placeholder-ui-drive.mjs`
  EXIT=0 @1440/1280/1024 (before: server cũ cắt giữa chữ — after: ellipsis;
  artifacts `qa/2026-10-28_sil541-hangtau-placeholder/`).
