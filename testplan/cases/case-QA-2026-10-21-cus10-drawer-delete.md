# Case QA-2026-10-21-cus10-drawer-delete — nút Xóa container trong drawer "Chi tiết container"

## Ruling (Frank, 21/10 — chốt xung đột CUS-10 vs TICKET-09)

"Bảng Chi tiết lô KHÔNG có nút thêm/xóa cont (TICKET-09 giữ nguyên). NHƯNG
trong DRAWER 'Chi tiết container' (quick-view mở từ Tổng quan) CẦN CÓ NÚT XÓA
CONT."

## Trạng thái trước fix

Drawer Tổng quan đã có nút per-row Xóa nhưng là ICON RÁC 26px và xóa NGAY khi
bấm — không confirm, mis-click = mất cont không hồi.

## Expected (sau fix)

| ID | Bước | Kỳ vọng |
|---|---|---|
| CUS10-R1 | Mở drawer Tổng quan (CUS/ADMIN/MANAGER/DISPATCHER) | mỗi hàng cont có nút **"Xóa container"** style danger (`btn--danger-outline`), aria-label `Xóa container <số>` |
| CUS10-R2 | role ACCOUNTANT hoặc DRIVER | KHÔNG có nút (mirror `requireWorkspaceWriter` của API) |
| CUS10-R3 | bấm "Xóa container <số>" | dialog confirm **"Xóa container <số>?"** (danger); API CHƯA gọi |
| CUS10-R4 | Hủy trong dialog | dialog đóng, KHÔNG gọi API, cont nguyên |
| CUS10-R5 | xác nhận "Xóa container" trong dialog | `POST /cus-workspace/:id/containers/:cid/remove` (API cũ) → toast "Đã xóa container <số>" → **drawer ĐÓNG** → danh sách chip mất cont (2x→1x) |
| CUS10-R5b | xóa khi lô có SỬA CHƯA LƯU ở hàng khác | xóa vẫn thành công; việc đóng drawer đi qua dirty-guard (`requestCloseMobileDetail`) → hiện dialog "bỏ thay đổi?" thay vì âm thầm vứt sửa của hàng khác (bảo vệ chủ đích, không phải bug) |
| CUS10-R6 | API chặn (đã điều xe / cont cuối FCL / version 409) | toast đúng reason API trả; dialog GIỮ MỞ để thử lại/Hủy; không refresh gì |
| CUS10-R7 | DB sau xóa | hàng `shipment_containers` bị hard-delete, `shipments.version` +1 |
| CUS10-R8 | TICKET-09 | bảng Chi tiết lô (`/shipments-detail`, `/shipments/:id`) VẪN không có nút thêm/xóa |

## Verify (21/10/2026)

- Vitest scoped 388/388 (9 file) gồm CUS-10 describe (permission render +
  confirm flow + guard 409) và các pin TICKET-09 còn xanh —
  `qa/2026-10-21-cus10-drawer-delete/gates-vitest-scoped.log`.
- UI DRIVEN: `qa/2026-10-21-cus10-drawer-delete/` — cus/lot 311985
  (QATU0001234): ui-1 (nút danger 2 hàng) → ui-2 (confirm "Xóa container
  QATU0001234?", removePosts=0 trước confirm) → REMOVE POST 200 → drawer đóng
  → ui-3 (chip 1x20DC) → ui-4 (re-open "1 cont", cont mất) → db-after.txt
  (hàng 141231 biến mất, version 1→2). R1, R3, R4, R5, R7, R8.
- Unit-only: R2 (canRemoveContainer=false ẩn nút), R6 (409 giữ dialog mở +
  reason toast).

## Not covered

- UI-drive R2 theo role thật (ACCOUNTANT/DRIVER) — chỉ unit pin.
- UI-drive R6 với lô thật gắn chuyến (fixture local chưa có).
- Mobile 390 của drawer (row-card CSS đã nâng touch floor 40px; chưa click).
