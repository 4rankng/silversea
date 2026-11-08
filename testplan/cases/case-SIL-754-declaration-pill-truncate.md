# SIL-754 (id 874) — Pill Tờ khai trên /shipments hiển thị đủ giá trị, không bị truncate

- Ticket: SIL-754 (board SIL, id 874, tạo 08/11/2026).
- Surface: `/shipments` — drawer chi tiết lô (`CusLotView`), cột Số tờ khai.

## Bug (kết quả thực tế trước fix)

Pill/ô input Số tờ khai trong bảng container của drawer chi tiết lô `/shipments` bị truncate chỉ còn `R8B472DE` (bị cắt trong hộp mono cứng 11ch), trong khi header hiện đủ `R8B472DECL01` (hoặc `R8B-472-DE`). Không có tooltip/title để xem đầy đủ khi chuỗi dài.

## Nguyên nhân

1. `.cus-lot-decl__input` bị fix cứng `width: 11ch;` với `padding: 0 8px;`, bề rộng thực chỉ chứa được ~8 ký tự font monospace trước khi tràn mép.
2. Cột `.cus-lot-col__declaration` có bề rộng 160px (content width ~136px sau trừ padding cell 2×12px), nhưng input chỉ dùng ~85px.
3. Không có thuộc tính `title` để hiển thị tooltip native khi hover chuột.

## Thay đổi (fix)

1. `frontend/src/pages/ShipmentsPage.css`: Cập nhật `.cus-lot-decl` có `flex-wrap: nowrap; width: 100%;`. Cập nhật `.cus-lot-decl__input` mở rộng `width: 100%; min-width: 11ch; max-width: 136px; flex: 1 1 auto;` tận dụng trọn vẹn 136px của cột 160px, hiển thị thoải mái 15 ký tự monospace mà không bị cắt chữ.
2. `frontend/src/features/shipments/cus/CusLotView.tsx`: Thêm `title={draft || undefined}` vào input và `title={persisted}` vào `span.cus-lot-decl__value` (chế độ xem chỉ đọc) để người dùng hover luôn xem được trọn vẹn số tờ khai.
3. Cập nhật unit test và density tests (`ShipmentsPage.density.test.ts`, `CusLotView.declaration.test.tsx`).

## Regression evidence

- Vitest: `src/pages/ShipmentsPage.density.test.ts`, `src/features/shipments/cus/CusLotView.declaration.test.tsx`, `src/features/shipments/cus/CusLotView.sil552-geometry.test.tsx` (24/24 passed).
- Frontend typecheck: `cd frontend && npx tsc -b` (0 errors).
