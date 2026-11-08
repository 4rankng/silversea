# SIL-757 (id 877) — Rút gọn nhãn nút Hoàn tất và filler text màn hình lái xe

- Ticket: SIL-757 (board SIL, id 877, tạo 08/11/2026).
- Surface:
  - Màn hình Lái xe Chi tiết Chuyến (`DriverTripDetailPage.tsx`, `driver-trip-model.ts`, `DriverTaskInfoSections.tsx`).
  - Form nhập chi phí chuyến (`ShipmentCostEntryForm.tsx`).

## Yêu cầu

1. Đổi nhãn nút sticky hoàn tất của lái xe: "Hoàn tất lệnh vận chuyển" → "Hoàn tất".
2. Đổi nhãn dialog xác nhận khi bấm hoàn tất: "Xác nhận hoàn tất lệnh vận chuyển?" → "Xác nhận hoàn tất?".
3. Bổ sung theo phản hồi Muse: Rút gọn các filler text dài dòng trên màn hình lái xe sang nhãn ngắn nghiệp vụ:
   - "Thêm ghi chú cho kế toán" → "Ghi chú kế toán".
   - "Thông tin xuất hóa đơn" → "Thông tin hóa đơn".

## Thay đổi (fix)

1. `frontend/src/features/driver/driver-trip-model.ts`: Cập nhật `completeCtaLabel` khi status là `IN_TRANSIT`: trả về `'Hoàn tất'`.
2. `frontend/src/pages/DriverTripDetailPage.tsx`: Cập nhật confirm dialog message thành `'Xác nhận hoàn tất?'`.
3. `frontend/src/components/trip/ShipmentCostEntryForm.tsx`: Đổi nhãn placeholder/button ghi chú kế toán thành `'Ghi chú kế toán'`.
4. `frontend/src/pages/driver/DriverTaskInfoSections.tsx`: Đổi tiêu đề collapsible section thành `'Thông tin hóa đơn'`.
5. Cập nhật các unit test liên quan (`driver-trip-model.test.ts`, `DriverTripDetailPage.test.tsx`, `ShipmentCostEntryForm.test.tsx`, `DriverTaskInfoSections.test.tsx`).

## Regression evidence

- Vitest: 4 test suites passed (161/161 tests).
