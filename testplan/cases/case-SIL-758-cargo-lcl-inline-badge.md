# SIL-758 (id 879) — Badge 'Lẻ' cột Tổng quan hàng hóa hiển thị inline gọn cùng dòng

- Ticket: SIL-758 (board SIL, id 879, tạo 08/11/2026).
- Surface: `/shipments` — bảng tổng hợp lô hàng (`CusShipmentRow`), cột Tổng quan hàng hóa (`td[data-label="Tổng quan hàng hóa"]`).

## Bug (kết quả thực tế trước fix)

Badge 'Lẻ' trên `/shipments` (cột TỔNG QUAN HÀNG HÓA) chiếm một dòng riêng phía trên '10 Pallet / 5 tấn' — xấu và lệch dòng so với các dòng cont FCL ('1 x 20DC / 12 tấn'), làm kéo giãn chiều cao dòng lô hàng LCL không cần thiết.

## Nguyên nhân

Trong `.cus-multiline-cell.cus-cargo-summary`, container có `display: grid; gap: 2px;`. Nếu badge 'Lẻ' được render như một phần tử con trực tiếp độc lập với dòng quy cách/số lượng kiện, grid sẽ phân bổ badge thành 1 row riêng biệt ở trên cùng (3 dòng thay vì 2 dòng).

## Thay đổi (fix)

1. `frontend/src/features/shipments/cus/CusShipmentRow.tsx`:
   - Bọc dòng thông số kiện (`specLines`) và badge LCL trong `<span className="cus-cargo-summary__line">`, đưa badge `<span className="cus-cargo-summary__lcl-badge" title="Hàng lẻ (LCL)">Lẻ</span>` thành suffix nhỏ inline ngay cạnh số lượng kiện trên cùng một dòng.
   - Dòng 1 hiển thị số lượng kiện + badge Lẻ inline (`10 Pallet [Lẻ]`).
   - Dòng 2 hiển thị khối lượng/thể tích (`5 tấn`).
   - Cấu trúc 2 dòng hoàn toàn đồng bộ, thẳng hàng và cân đối với các dòng container FCL (`1 x 20DC / 12 tấn`).
2. `frontend/src/pages/ShipmentsPage.css`:
   - Thêm `.cus-cargo-summary__line` với `display: inline-flex; align-items: center; gap: 4px;`.
   - Thêm `.cus-cargo-summary__lcl-badge` với chiều cao 18px gọn gàng, font caption 11px, màu trung tính đồng bộ theo design system (`--chip-neutral-bg`, `--chip-neutral-border`, `--ink-2`).
3. Cập nhật và bổ sung unit tests:
   - `frontend/src/features/shipments/cus/CusShipmentRow.cus-cards.test.tsx`: test kiểm tra badge Lẻ inline cạnh `10 Pallet`.
   - `frontend/src/pages/ShipmentsPage.test.tsx`: cập nhật test xuất XLSX và xác nhận badge Lẻ inline.

## Verification evidence

- Scoped Vitest:
  - `src/features/shipments/cus/CusShipmentRow.cus-cards.test.tsx` (35/35 passed).
  - `src/pages/ShipmentsPage.test.tsx` (passed).
  - All 27 suites under `src/features/shipments/cus/` (223/223 passed).
- Frontend typecheck: `cd frontend && npx tsc -b` (0 errors).
- Rung-3 UI Driven:
  - Command: `node qa/2026-11-08_sil758_ui-drive.mjs` (exitCode=0).
  - Screenshot 1440px: `qa/2026-11-08_SIL-758_ui-1440.png`.
  - Driver log: `qa/2026-11-08_SIL-758_ui-driver.log`.
