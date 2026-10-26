# SIL-518 — bỏ dòng "CUS sẽ bổ sung" ở cột ĐIỀU PHỐI khi chưa phân nhà xe

- Ticket: SIL-518 (board SIL, id 580, Todo) — owner 26/10, ảnh đính kèm ticket
  (khung đỏ quanh các dòng "Chưa phân nhà xe / *CUS sẽ bổ sung*").
- Surface: `/dispatch-detail` bảng (≥640px) cột ĐIỀU PHỐI + card list mobile
  (<640px) — cùng một placeholder, một luật.

## Yêu cầu owner

1. Dòng chưa phân nhà xe đang hiện 2 dòng: "Chưa phân nhà xe" + italic
   "CUS sẽ bổ sung" bên dưới.
2. Bỏ dòng "CUS sẽ bổ sung" — để trống. Chỉ còn "Chưa phân nhà xe".

## Case pin (expected sau thay đổi)

1. Row chưa có plate + KHÔNG phải nhà xe nội bộ (OWN): KHÔNG render dòng
   placeholder — cột chỉ còn dòng nhà xe ("Chưa phân nhà xe" / tên nhà xe ngoài).
2. Row OWN chưa có plate vẫn giữ "Chưa phân xe" italic (state nội bộ riêng,
   không thuộc ticket — owner chỉ bỏ dòng "CUS sẽ bổ sung").
3. Sweep sibling: card mobile (dpcard dòng 1 BKS) bỏ cùng placeholder — dòng 1
   rỗng khi chưa có BKS (không render span, không chừa hàng trống).
4. Chip trạng thái UNASSIGNED vẫn render nothing (một concept một chỗ —
   carrier line đã nói trạng thái).

## Regression lock

- `DetailedPlanGrid.test.tsx` — unassigned EXTERNAL row: không còn text
  "CUS sẽ bổ sung" trong cell, không render `.dispatch-assignment-cell__plate`.
- `DispatchPlanCardList.test.tsx` — external deferred: không `.dpcard__plate`.

## Gates

- Scoped vitest + tsgo + rung-3 driver MODE=T2 @1440 (lọc "Chưa gán xe" để
  thấy đúng nhóm row chưa phân nhà xe).
