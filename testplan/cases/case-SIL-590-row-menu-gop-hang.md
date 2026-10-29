# SIL-590 (id 690) — Kế hoạch Chi tiết Xe: "Gộp hàng" trên dòng lô chạy tại chỗ, hết bị đưa về Kế hoạch Tổng quát

- Ticket: SIL-590 (board SIL, id 690, priority medium) — báo cáo khách b_d. Phạm Trung Kiên 29/10/2026.
- Surface: `/dispatch-detail` (Kế hoạch Chi tiết Xe) — menu ⋯ của dòng lô, role Điều vận.

## Bug (bản build cũ khách đang dùng)

Bấm thao tác "Gộp hàng" trên một dòng lô ở Kế hoạch Chi tiết Xe → app quay về
màn hình Kế hoạch Tổng quát thay vì cho gộp tại chỗ (build cũ hiểu gộp xe phải
gộp ở màn tổng quát).

## Expected sau thay đổi

1. Menu ⋯ của dòng lô hàng lẻ CHƯA ghép có item "Gộp hàng" (icon Layers — cùng
   icon với nút Gộp hàng trên filter strip).
2. Bấm "Gộp hàng" → bật chế độ gộp ngay tại màn hình Chi tiết và tích sẵn
   dòng đó (Lô 1 — giữ 100% cước trả ĐV); thanh chọn nổi hiện "Đang chọn 1
   lô…" với hint "Nhóm ghép cần ít nhất 2 lô". KHÔNG điều hướng đi đâu.
3. Dispatcher tích thêm lô khác → "Gán xe nhóm" → popup 4 trường (loại xe tính
   cước, nhà xe, BKS thực…) → lưu xong thoát chế độ, refetch — toàn bộ tại
   `/dispatch-detail`.
4. Dòng đã thuộc nhóm ghép KHÔNG có item "Gộp hàng" (verb của nó: Đổi nhà
   xe/BKS + Tách nhóm; FB-095 cấm ghép lại khi đang trong nhóm).
5. Dòng FCL không có item. Khi chế độ gộp đang bật (CHỌN hiện), menu không
   lặp item — checkbox là affordance chính.

## Regression lock

- `frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.row-menu.test.tsx`
  — describe "SIL-590 — row menu Gộp hàng": ungrouped LCL raise handler với
  đúng shipmentId; grouped / FCL / thiếu handler (mode đang bật) đều không
  có item.
- Handler page: `startLclMergeFromRow` = setLclMergeMode(true) +
  setSelectedLclRows([row]) — truyền xuống grid chỉ khi mode OFF
  (`lclMergeMode ? undefined : startLclMergeFromRow`).
