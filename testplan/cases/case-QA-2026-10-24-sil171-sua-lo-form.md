# Case QA-2026-10-24-SIL171 — Sửa lô phải mở lại form Tạo lô hàng (pre-fill + PATCH)

Ticket SIL-171 / FB-147 (board plan.tingting.vip; QA R41 @ fe966b30). Khách
Zalo 24/10 + QA: form sửa = DÙNG LẠI form tạo lô (cùng layout, pre-fill dữ
liệu lô). Ghi chú SIL-166 đã chỉ hướng này trước đó.

Surface: `/shipments/:id` header → nút "Sửa lô" → `/shipments/:id/edit`
(`ShipmentCreateWorkspace` chế độ edit). Dialog 6 nút cũ giữ nguyên làm
fallback qua nút "Sửa nhanh".

## Root cause

"Sửa lô" (FB-086 R29, 21/10) chỉ mở group-picker 6 nút (Khách hàng & nhà
máy · Chứng từ · Phân loại & hãng tàu · Tổng quan hàng hóa · Lịch trình ·
Ghi chú) rồi sub-dialog quick-edit theo nhóm — không có trường Hình thức
XNK, không layout form tạo. Không surface nào cho sửa TOÀN BỘ lô như lúc
tạo.

## Expected (sau fix)

| ID | Bước | Kỳ vọng |
|---|---|---|
| SIL171-R1 | CUS mở `/shipments/186` → bấm "Sửa lô" | Điều hướng `/shipments/186/edit` — form "Sửa lô hàng" đúng layout form Tạo lô hàng (cùng section, cùng validation) |
| SIL171-R2 | Đọc form sau khi mở | Pre-fill TOÀN BỘ: Khách hàng, Hình thức XNK (IMPORT/EXPORT), Số Bill/Booking, Hãng tàu, Số tờ khai (chip), container rows (loại cont, nhà máy, tuyến, cảng nâng/hạ, giờ đóng trả), LCL: kho/nhà máy/trọng lượng/kiện/ngày giao, ghi chú KH + lái xe |
| SIL171-R3 | Sửa 1 trường (vd Số Bill) → "Lưu thay đổi" | `PUT /shipments/:id` (updateShipment) với `expectedVersion` hiện hành — KHÔNG gọi `POST /shipments/quick`; container reconcile theo persisted id (update-by-id, không delete+reinsert); tờ khai không đổi thì không phát sinh call declaration |
| SIL171-R4 | Xoá trường bắt buộc (vd Số Bill hàng Nhập) → lưu | Bị chặn bởi đúng validation form tạo ("Hàng Nhập cần Số Bill."), không gọi PATCH |
| SIL171-R5 | Lưu thành công | Về `/shipments/:id`, dữ liệu mới hiển thị |
| SIL171-R6 | Bấm "Sửa nhanh" | Dialog "Sửa thông tin lô" 6 nút cũ vẫn mở bình thường (fallback, không xóa) |
| SIL171-R7 | ACCOUNTANT / lô đang khóa kế toán | Không thấy "Sửa lô" + "Sửa nhanh" (như cũ) |
| SIL171-R8 | Bill/Booking trùng lô khác | Duplicate guard vẫn cảnh báo, nhưng lô CHÍNH NÓ không tự-cảnh báo (excludeShipmentId) |
| SIL171-R9 | Vitest | `ClerkShipmentEditPage.test.tsx` (mở form edit, pre-fill XNK, submit PATCH, validation, lỗi tải) + `shipment-edit-prefill.test.ts` (mapping FCL/LCL/ad-hoc) + `ShipmentDetailPage.test.tsx` (Sửa lô navigate, Sửa nhanh mở picker) + `App.shipments-edit-route.test.tsx` |

## Rule (PRD)

Form sửa = form tạo (khách Zalo 24/10, lần 2 yêu cầu mặt này; SIL-166 note
cùng hướng). Owner 24/10: KHÔNG kéo Done — QA gate.
