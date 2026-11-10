# Case SIL-758 (id 879) — badge 'Lẻ' cột TỔNG QUAN HÀNG HÓA: suffix inline cuối dòng

## Yêu cầu owner (09/11, luồng r8b)

Nhãn 'Lẻ' phải là **suffix inline CUỐI dòng số lượng** đúng dạng
`10 Pallet / 5 tấn · Lẻ` — cùng hình thái với dòng cont FCL (`1 x 20DC / 12 tấn`),
không chiếm dòng riêng, không đứng TRƯỚC/trên số lượng. Chip 'Lẻ' đồng bộ hệ
chip hiện có (neutral chip tokens, như chip 'Lẻ' ở cột PHÂN LOẠI).

- Lịch sử: bản sửa đầu (e86a9b14, 08/11) đặt badge cạnh số kiện nhưng vẫn để
  trọng lượng dòng dưới ('10 Pallet [Lẻ]' / '5 tấn') → owner yêu cầu dạng
  1 dòng '10 Pallet / 5 tấn · Lẻ'.
- Implementation: `frontend/src/features/shipments/cus/CusShipmentRow.tsx`
  (khối `cargoMode === 'LCL'`), CSS `frontend/src/pages/ShipmentsPage.css`
  (`.cus-cargo-summary__lcl-sep` + `.cus-cargo-summary__lcl-badge`).

## Reproduction

1. /shipments (CUS), tìm lô LCL có hàng (vd `SIL704-lcl_share-…-L2`, 10 Pallet,
   5 tấn).
2. Đọc ô TỔNG QUAN HÀNG HÓA.

## Expected

- Một dòng duy nhất: `10 Pallet / 5 tấn` (+ ` · 12 CBM` nếu có thể tích) rồi
  `·` và chip `Lẻ` (title "Hàng lẻ (LCL)") ở CUỐI dòng.
- LCL không có số đo: `5 tấn · Lẻ` / `Chưa có hàng hóa · Lẻ` — chip vẫn cuối dòng.
- DOM pin: `CusShipmentRow.cus-cards.test.tsx` — strong textContent
  `'10 Pallet / 5 tấn · 12 CBM'`, badge CUỐI line (`line.textContent`
  kết thúc bằng `· Lẻ`), không còn `.cus-cargo-summary__weight` riêng cho LCL.

## Status

FIXED on `fix/r8b-717-697-758` (base origin/main 6d7a3886). Screenshot 1440px +
driver log: `qa/2026-11-09_SIL-758_ui-1440.png`, `qa/2026-11-09_SIL-758_ui-driver.log`.
