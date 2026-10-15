# FB-092 — LCL Kế hoạch Chi tiết Xe: gom chuyến trả ĐV + xe ảo + nhảy tiền

Nguồn: kanban/TODO/FB-092-lcl-chitiet-xe-grouping.md (DEV SPEC §II.2.2), phụ thuộc FB-090.
Ngày: 2026-10-15.

## Phạm vi

- Backend: cột nhóm trên `shipments` (cost_group_id/order, rev_group_id/order,
  billing_truck_no, actual_truck_no, cost_vehicle_class_id) + service gán nhóm
  chi phí (dimension `cost`) + đọc lại các trường đó trên shipment list rows.
- Frontend: dòng LCL trên Kế hoạch Chi tiết Xe (3 dòng ô CONTAINER), chọn nhiều
  lô → thanh tổng, popup "Gán xe nhóm", tag "Lẻ · Ghép (i/N)".
- Dimension `rev` (nhóm thu) chỉ landing schema/service ở vé này; UI ghép cước
  thu thuộc FB-093.

## Case hồi quy

### FB092-01 — dòng LCL trên Chi tiết Xe hiển thị 3 dòng ô CONTAINER
1. Mở Kế hoạch Chi tiết Xe có lô LCL (đã nhập số lượng/bao bì/kg/CBM).
2. Ô CONTAINER của dòng Lẻ: đúng 3 dòng — `Lẻ · Xe {loại}` (hoặc `Lẻ` khi chưa
   gán loại), `{số lượng} {bao bì}`, `{kg} · {CBM}` (CBM bỏ khi thiếu).
3. Dòng FCL không đổi.

### FB092-02 — chọn nhiều lô Lẻ hiện thanh tổng
1. Tích checkbox ≥2 dòng LCL.
2. Thanh hiện "Đang chọn N lô: Tổng X kg | Y CBM" đúng tổng theo lựa chọn.
3. Bỏ chọn → thanh biến mất.

### FB092-03 — popup Gán xe nhóm lưu đủ nhóm + xe
1. Chọn ≥2 lô LCL → "Gán xe nhóm".
2. Chọn loại xe (trọng tải hoặc cont), nhập BKS thực; BKS báo khách tự copy
   từ BKS thực, sửa được (combobox gợi ý BKS hệ thống + free text).
3. Lưu: mọi lô được chọn có cùng cost_group_id; order 1..N theo thứ tự chọn;
   billing/actual BKS + loại xe lưu trên từng lô; tag "Lẻ · Ghép (1/N)".

### FB092-04 — luật nguồn xe (FB-090)
1. Loại xe trọng tải (is_container=false): chọn BKS trùng xe nội bộ → chặn với
   lỗi "Hàng lẻ xe tải 100% xe ngoài".
2. Loại cont (is_container=true): BKS nội bộ được chấp nhận.

### FB092-05 — nhảy tiền cước trả ĐV (cost_group)
1. Gán nhóm cho các lô đã có trip live với external_freight_cost > 0.
2. Sau lưu: trip của Lô 1 giữ nguyên giá trị; trip Lô 2..N có
   external_freight_cost = 0.

### FB092-06 — validation đầu vào service
1. Gán nhóm gồm lô FCL → lỗi chặn.
2. Gán 1 lô duy nhất → lỗi chặn (nhóm cần ≥2).
3. Lô thuộc nhóm cost khác → lỗi chặn (phải tách trước, FB-095).

## Gate

- backend: `npx tsc --noEmit`, test file grouping (integration, DB thật).
- frontend: `npx tsc -b`, vitest các file chạm vào.
- shared: `npx tsc` khi đổi contract.
