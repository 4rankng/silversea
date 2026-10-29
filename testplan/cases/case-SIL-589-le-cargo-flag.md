# SIL-589 (id 689) — Kế hoạch Tổng quát: dòng lô lẻ có tag "Lẻ" (và "· Ghép" khi đã gộp) tại cột Tổng quan hàng hóa

- Ticket: SIL-589 (board SIL, id 689, priority medium) — báo cáo khách b_d. Phạm Trung Kiên 29/10/2026.
- Surface: `/dispatch` bảng Kế hoạch Tổng quát — cột "Tổng quan hàng hóa" (grid + card mobile), role Điều vận.

## Bug

Các dòng lô chỉ hiện số liệu ("1 x 40DC", "2 Roll 0,01 tấn", "2 Pallet 0,1 tấn")
— không có dấu hiệu nào phân biệt lô hàng lẻ (LCL) với lô FCL, cũng như lô lẻ
đã ghép nhóm so với lô chưa ghép.

## Expected sau thay đổi

1. Mọi dòng LCL (`isLclLotRow` — cùng predicate với checkbox CHỌN của chế độ
   gộp hàng) hiển thị flag text "Lẻ" ở cell Tổng quan hàng hóa, phía trên dòng
   demand. Text-only (§1, cùng giọng label Phân loại ở Chi tiết Xe) — không
   pill, không nhìn như nút.
2. Lô LCL đã thuộc nhóm ghép trả ĐV (`costGroupId != null`) hiển thị
   "Lẻ · Ghép" với title nêu BKS thực của xe nhóm — đã ghép vs chưa ghép là
   một cái nhìn phân biệt được.
3. Dòng FCL không bao giờ có flag ("Lẻ" / "Lẻ · Ghép" đều vắng).
4. Card mobile (≤760px): token loại hàng đọc "Lẻ" / "Lẻ · Ghép" cùng luật
   (trước đây chỉ có "· Lẻ", không phân biệt trạng thái gộp).

## Regression lock

- `frontend/src/features/dispatch/master-plan/MasterPlanGrid.lcl-display.test.tsx`
  — describe "the Lẻ cargo flag (SIL-589)": ungrouped "Lẻ", grouped
  "Lẻ · Ghép", projection `hasActiveLclShipment` (FCL cargoMode vẫn Lẻ), FCL
  không flag.
- Flag đọc `isLclLotRow(item)` + `item.costGroupId` — cùng nguồn dữ liệu với
  checkbox CHỌN, không thể lệch nhau trên cùng một dòng.
