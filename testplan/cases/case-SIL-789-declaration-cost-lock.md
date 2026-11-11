# case-SIL-789 — Lô khóa kế toán chặn sửa số tờ khai (tại nguồn)

## Repro (staging dc930964, 10/11)
Lot khóa từ Chốt giá bán ([Khóa Lô] → shipment_cost_locks, unlockedAt NULL):
ô tờ khai cấp container còn ENABLED, lưu POST /api/shipments/cus-workspace/
:id/containers/:cid trả 200, DECL mới được ghi.

## Expected (KB Ch3 §3.4.3 + Ch2 §2.6.2)
Ô bị disabled kèm dòng lý do "Lô hàng đã khóa kế toán; không thể sửa tờ khai."
và lệnh lưu bị chặn TẠI NGUỒN.

## Fix
- BE: `assertShipmentDeclarationEditableByCostLock` chặn 409 đúng câu KB trong
  `updateCusShipmentContainerLine` (nhánh tờ khai) + `copyCusShipmentContainerDeclaration`.
- Wire: `summary.costLocked` (schema strict, default false) + fieldAccess
  declarationNumber READ_ONLY cùng lý do khi khóa chi phí.
- FE: CUS drawer cell tĩnh + caption lý do; dispatch container-detail tắt editor
  + note dưới cột Số tờ khai.

## Pins
- BE unit `sil789-declaration-cost-lock.test.ts` (6 pin wiring nguồn, không db).
- FE `CusLotView.declaration.test.tsx` (2 pin: có lý do khi khóa / không có khi
  chỉ gate vai).
