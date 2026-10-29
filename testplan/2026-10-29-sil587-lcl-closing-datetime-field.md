# SIL-587 (id 687) — Tạo lô hàng lẻ: thiếu trường "Ngày giờ đóng trả"

- Nguồn: khách hàng (b_d. Phạm Trung Kiên) 29/10/2026, kèm ảnh chụp màn hình.
- Link: plan.tingting.vip SIL-587.

## Tái hiện

1. Mở "Tạo lô hàng", chọn "Hàng lẻ".
2. Form chỉ có ô "Ngày giao hàng" dạng ngày (không giờ), không có trường đóng trả.

## Kỳ vọng sau fix

- Trường duy nhất trong band Loại hàng là "Ngày giờ đóng trả" (ngày + giờ,
  24h), luôn mở sẵn, có dấu * (bắt buộc khi tạo).
- Lưu payload: hướng Nhập → `plannedReturnAt`, hướng khác (Xuất) → `closingAt`
  (cùng luật direction-correct với quick-edit "Chỉnh sửa Lịch trình"); giá trị
  persist là instant +07:00.
- `expectedDeliveryDate` (wire không đổi) = phần NGÀY của datetime theo giờ VN
  — lọc ngày và auto-status giữ nguyên tác dụng.
- Sửa lô (edit): prefill trường từ instant đúng hướng; lô cũ chỉ có EDD thì
  trường trống nhưng EDD giữ nguyên khi lưu, không bắt nhập lại.
- Chuyển FCL↔LCL: giá trị đã nhập thuộc dạng draft dữ liệu → phải qua confirm
  "Chuyển loại hàng?"; chuyển sang FCL thì xóa giá trị.

## Case ID

- SIL-587-C1: label + marks — `[data-field-id="shipment-lcl-closing-at"]`
  chứa "Ngày giờ đóng trả" và "*", đúng một field.
- SIL-587-C2: payload EXPORT — `lclClosingAt '2026-10-29T14:30'` →
  `closingAt '2026-10-29T14:30:00+07:00'`, `plannedReturnAt null`,
  `expectedDeliveryDate '2026-10-29'`.
- SIL-587-C3: payload IMPORT — cùng giá trị → `plannedReturnAt
  '2026-10-29T14:30:00+07:00'`, `closingAt null`.
- SIL-587-C4: validation — LCL trống cả datetime lẫn EDD → issue
  `shipment-lcl-closing-at` "Chọn ngày giờ đóng trả."; có EDD (edit lô cũ)
  → không issue.
- SIL-587-C5: EDD bắc cầu ICT — datetime 23:50 ngày 29/10 giữ nguyên ngày VN
  2026-10-29 trong EDD (string surgery, không qua múi giờ máy).
