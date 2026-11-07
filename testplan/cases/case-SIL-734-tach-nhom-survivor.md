# SIL-734 (id 854) — Bảo toàn cước Tách nhóm / Xóa Lô chính LCL

- Ticket: SIL-734 (board SIL, id 854, tạo 07/11/2026, HIGH). Lane K1.
- Surface: chot-debit + Chi phí - Quyết toán (Tách nhóm), backend
  lcl-grouping.service.ts (unmerge/promote/pricing), shipment-lifecycle
  (delete hook).

## Bug / gap (trước fix)

(a) Nút [Tách nhóm] per-row trên chot-debit chỉ render khi `revGroupId != null`
— dòng ghép COST (revGroupId null, costGroupId set — case R42) không có lối
vào row-level, chỉ còn strip ≥2 chọn.
(b) Tách nhóm CẢ NHÓM (REV) restore pre-merge; khi không có pre-merge thật
(member tạo sau merge / capture 0) → kẹt 0₫ CƯỚC VẬN TẢI AUTO + TỔNG PHẢI
THU; FB-145 lại XÓA `revVehicleClassId` ngay trên đường đó → khóa tra bảng giá.
(c) Xóa Lô chính: engine survivor (promotePrincipalOnRemoval +
promoteLclGroupsOnShipmentDelete, bật 26/10) — DB tests đã xóa theo owner
ruling 19/10 (da4d2f0b), chỉ còn regex pins; incident 3.500.000₫ (SIL-489,
read-side) đã fix 26/10. Cần kiểm chứng full chain + tiền không mất đồng nào.

## Case pin (expected sau thay đổi)

1. (a) Dòng ghép REV hoặc COST trên chot-debit đều có nút [Tách nhóm] per-row
   (dimension đúng nhóm); dòng cost-locked vẫn bị chặn với lý do nguyên văn.
2. (b) Tách cả nhóm REV, member không có pre-merge thật → tự tra Bảng giá
   theo lane key của TỪNG lô (revVehicleClassId + route + customer + ngày,
   capture TRƯỚC khi xóa class); tra trúng → ghi tiền + reason ngoài nhóm;
   tra trượt → giữ cited 'Chờ tra lại bảng giá' (KHÔNG tự chế số).
   Member có pre-merge thật → restore giữ luật (tiền về đúng số trước ghép).
3. (b-pin) Tổng nhóm trước tách = Σ tiền sau tách từng lô (không phát sinh,
   không mất).
4. (c) Xóa Lô 1 (trong group): survivor kế vị nhận 100% cước (REV thu + COST
   trả/manual + driver) + order=1 + giữ BKS ảo; leaver ghost-guard: các reader
   principal chỉ đọc dòng live; tổng bảo toàn.
5. Không dùng lại tiền ở 2 dòng live (leaver đã xóa mới được giữ snapshot).

## Regression evidence

- (điền sau) BE unit tests mới (re-price decision pure + source pins) +
  FE test COST row button + probe thật trên local DB (qa driver) nếu stack
  chạy, qa/2026-11-07-lane-k1/.
