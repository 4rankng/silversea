# Case SIL-765 — Form tạo lô hàng lẻ: nhiều kho lấy hàng qua [+ Thêm kho lấy hàng]

Nguồn: SIL-765 (board SIL), file 2026.11.09.Ticket.docx — Phần VI Epic 5, yêu cầu 5.2 (CR-006, nhóm B).
Surface: `/shipments/new` tab Hàng lẻ → `ShipmentCreateLclRouteSection.tsx`; persistence `shipments.pickup_warehouse_site_id`.

## Reproduction (hiện trạng, staging build 7c7db25c 09/11)

1. Đăng nhập CUS tiepvv → Tạo lô hàng → tab Hàng lẻ.
2. Trường "Kho lấy hàng *" chỉ có 1 ô chọn. Nút "+ Thêm kho" bên dưới là quick-add kho vào DANH MỤC DÙNG CHUNG (dialog "Thêm kho lấy hàng") — không phải thêm điểm bốc hàng cho lô.
3. Không có cách nào nhập kho lấy hàng thứ hai cho cùng 1 lô.

## Expected behavior (sau fix)

1. Trường Kho lấy hàng có nút [+ Thêm kho lấy hàng] (khác nhãn "+ Thêm kho" danh mục — nút danh mục giữ nguyên, không mất).
2. Bấm [+ Thêm kho lấy hàng] thêm ô kho thứ 2, thứ 3…; mỗi ô chọn 1 kho (danh mục dùng chung hoặc gõ tay — cùng hybrid contract ô đầu); mỗi ô thêm có nút xóa riêng.
3. Tạo lô với 2 kho lấy hàng khác nhau → lưu → mở chi tiết lô thấy đủ cả 2 kho.
4. Tạo lô chỉ với 1 kho vẫn chạy bình thường (ô thêm không bắt buộc); validation lô không kho (không phải lệnh chạy ngoài) giữ nguyên thông báo "Chọn kho lấy hàng.".
5. Kho bổ sung đi qua validate backend như kho chính: site phải là WAREHOUSE active (409 "Kho lấy hàng không còn hiệu lực." khi stale); gõ tay không có site vẫn lưu tên.

## Out of scope

- Yêu cầu 5.1 (bỏ bắt buộc "Thông tin/Mô tả hàng hóa") — form hiện không còn trường này, đã kiểm chứng trên ticket.

## Verification

- Unit: `shipment-create-model.test.ts` (payload 2 kho), backend unit (persist child rows + validate), component test thêm/xóa dòng, chi tiết hiển thị 2 kho.
- UI DRIVEN: tiepvv tạo lô 2 kho → lưu → chi tiết; screenshot + DOM + DB proof (`shipment_pickup_warehouses`) + driver log.
