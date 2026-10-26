# Case: SIL-503 — /shipments-detail hàng LẺ: SỐ TỜ KHAI + PHÂN XE click-to-edit (FCL-cell parity)

- **Ticket:** SIL-503 (board id 565) — CUS 26/10: 4 row LOG COM hàng lẻ không nhập được
  tờ khai + không phân xe được — cell dead trên /shipments-detail (FCL rows OK).
- **Date:** 2026-10-26
- **Branch:** fix-lcl-cell-edit (off main fb031edb)
- **Pattern tham chiếu:** FB-093a (BKS báo khách Ảo quick edit trong cell lot — cùng
  endpoint `updateLclTruck`) + FCL documents editor (Số tờ khai cell click → editor).

## Bug

Row hàng LẺ (lot-level, `isLotLevel: true`, `id = -shipmentId`) trên /shipments-detail
bị gate `canEdit = enabled && row.isLotLevel !== true` ép READ-ONLY trên MỌI cell —
click không có tác dụng. CUS không nhập được tờ khai, không nhập được BKS thực
(phân xe), trong khi FCL rows click-to-edit bình thường.

## Expected behavior (AC)

1. **SỐ TỜ KHAI (lot row)**: click cell mở ĐÚNG documents editor như FCL (5 trường).
   Save: Bill/Booking/Nhập/Xuất/Hãng tàu → `PUT /shipments/:id` (shipment-level);
   Số tờ khai → shipment-declaration API (`POST/PUT /shipments/:id/declarations...`)
   theo diff: có row → PUT metadata verbatim, không row → POST, xoá số → PUT number
   null. Giới hạn: session documents là MỘT mode duy nhất lot row được mở
   (`startEdit` từ chối mode khác cho lot row).
2. **PHÂN XE (lot row)**: BKS thực click-to-edit theo house pattern FB-093a:
   trigger trong cell → combobox "BKS thực" → Lưu → `POST /shipments/lcl/truck`
   `{shipmentId, actualTruckNo}`. Lot CHƯA phân xe ("Chưa phân xe") vẫn có nút
   "Nhập BKS thực" mở cùng editor. Dòng composite "Nhà xe - BKS Thực: X" giữ
   STATIC TEXT (giữ contract FB-093a: dòng thực không phải control).
3. **FCL parity hai chiều**: FCL rows không đổi byte-for-byte (cell triggers, editor,
   luồng lưu container-line). Cùng một board có cả FCL row + LCL lot row ("2 loại
   hàng cùng board") — mỗi loại giữ contract riêng.
4. Lot row giữ read-only ở mọi cell khác (identity/route/schedule/notes/container).
5. Số tờ khai trùng lô khác → server chặn (duplicate-reference guard có sẵn);
   FE không tự kiểm tra trùng.

## Out of scope (ghi nhận minh bạch)

- Gán NHÀ XE (carrier) cho lot row: không có endpoint lot-level cho planned carrier
  (chỉ dispatch flow `assignLclCostGroup` — ADMIN/MANAGER/DISPATCHER, có side-effect
  cost group + pricing). Cell PHÂN XE lot sửa được BKS thực + BKS Ảo; việc gán nhà xe
  vẫn thuộc Kế hoạch làm hàng. Nếu owner muốn parity đầy đủ (nhà xe + tạo assignment
  từ board này) → cần backend surface mới, tách lane.
- fix-overview-tokhai (SIL-502) — khác lane, không đụng file.
- dispatchStatus lot KHÔNG đổi sang "Đã điều xe" khi CUS chỉ nhập BKS thực
  (trạng thái do assignment quyết — server-authoritative, không fake).

## Regression steps

1. `make dev`; login CUS (testplan/testaccounts.txt).
2. /shipments-detail → chọn lô LCL (hàng lẻ) chưa có tờ khai.
3. Click cell Số tờ khai → editor mở, tiêu đề "Lô <bill>"; nhập số → Lưu.
   Kỳ vọng: toast thành công, cell hiện số, DB `shipment_declarations` có row mới.
4. Click trigger "Sửa BKS thực" trong cell Phân xe → nhập biển → Lưu.
   Kỳ vọng: `shipments.actual_truck_no` cập nhật; cell hiện biển mới.
5. Lô FCL cùng board: click Số tờ khai → editor như cũ; lưu số → số đổ vào
   container-line (per-cont) như trước.
6. Reload trang: cả hai giá trị persist.

## Gates

- Scoped vitest (ledger + cusDetailModel + fb093a suite) — all pass.
- `cd frontend && npx tsgo -b` — 0 lỗi.
- Screenshots + driver log 1440 (`qa/2026-10-26-sil503-lcl-cell-edit/`).
