# SIL-756 (id 876) — Chống ngắt dòng giữa chuỗi cho số container và số tờ khai

- Ticket: SIL-756 (board SIL, id 876, tạo 08/11/2026).
- Surface:
  - `/dispatch-detail` (Kế hoạch Chi tiết Xe) — cột Container (`.ops-container-line`) và cột Số tờ khai (`.detailed-plan-grid__decl-value`).
  - `/shipments-detail` (Chi tiết lô hàng) — cột Số tờ khai, Bill/Booking (`.shipment-container-ledger__code`).

## Bug (kết quả thực tế trước fix)

Các chuỗi định danh đơn lẻ (identifier tokens) bị ngắt dòng ở giữa chuỗi do `overflow-wrap: anywhere;`:
- Trên `/dispatch-detail`: Số serial container 11 ký tự `QACU2000507` bị ngắt thành `QACU200050` (dòng 1) và `7` (dòng 2).
- Trên `/shipments-detail`: Số tờ khai `TK1108R002` bị ngắt thành `TK1108R` (dòng 1) và `002` (dòng 2).

## Nguyên nhân

1. Trên bảng `/dispatch-detail`, `.detailed-plan-grid__line` áp dụng `overflow-wrap: anywhere;`. Mặc dù container code là mã định danh ISO 11 ký tự, không có quy tắc `white-space: nowrap; overflow-wrap: normal;` riêng trên `.ops-container-line` khiến chữ số cuối bị đẩy xuống dòng tiếp theo.
2. Trên bảng `/shipments-detail`, file `ShipmentContainersPage.css` chỉ mới cấu hình `nowrap` cho `td[data-label="Thông số container"]`, trong khi `td[data-label="Số tờ khai"]` và `td[data-label="Bill/Booking"]` vẫn chịu `overflow-wrap: anywhere;` kế thừa từ `td`.

## Thay đổi (fix)

1. `DetailedPlanGrid.css`:
   - Bổ sung quy tắc cho `.detailed-plan-grid__cell--container .ops-container-line`: `white-space: nowrap; overflow-wrap: normal; word-break: normal;` giữ số cont luôn nguyên vẹn trên 1 dòng.
   - Cập nhật `.detailed-plan-grid__decl-value`: `white-space: nowrap; overflow-wrap: normal; word-break: normal;` giữ số tờ khai không bị ngắt dòng giữa chừng.
2. `ShipmentContainersPage.css`: Mở rộng quy tắc nowrap sang `td[data-label="Số tờ khai"]` và `td[data-label="Bill/Booking"]` cho `.shipment-container-ledger__code`.
3. `ShipmentContainerLedger.tsx`: Thêm `title` tooltip chứa toàn bộ giá trị cho Bill/Booking và Số tờ khai.
4. Cập nhật test style pins (`DetailedPlanGrid.rowheights.styles.test.ts`, `ShipmentContainersPage.no-truncation.styles.test.ts`).

## Regression evidence

- Vitest: `DetailedPlanGrid.container-port-weight.test.tsx`, `DetailedPlanGrid.rowheights.styles.test.ts`, `ShipmentContainersPage.no-truncation.styles.test.ts` (19/19 passed).
