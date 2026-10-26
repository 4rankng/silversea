# SIL-494 — "Đổi BKS nhóm" chấp nhận chuỗi "Bổ sung sau" gõ tay + actualTruckNo stale sau defer

- Ticket: SIL-494 (board id 556), QA FAIL R3 26/10/2026 trên build 52ee6443
- Branch: fix-494-496

## Case ID: SIL-494-R3-GROUP-DEFER-LABEL

### Repro (đã có trên build 52ee6443)

1. Đăng nhập Điều vận (dungnv) — lô LCL đang GHÉP NHÓM (cost group ≥2 lô, BKS nhóm thật, vd 99H-004.59).
2. Menu nhóm → "Đổi BKS nhóm" → ô "BKS thực (xe chạy chuyến)" gõ tay chuỗi `Bổ sung sau` (đường "gõ mới" của USearchableField, `allowsCustomValue`).
3. Bấm "Lưu BKS nhóm".

Actual (bug): lưu thành công — cả nhóm member có `shipments.actual_truck_no = 'Bổ sung sau'`.
Expected: bị chặn kèm lý do; defer chỉ hợp lệ trên LÔ ĐƠN qua nút "Bổ sung sau" riêng của editor.

### Fix

1. Shared wire contract (`shared/src/schemas/lcl-grouping.ts`): `truckNo` từ chối literal
   "Bổ sung sau" + biến thể whitespace/case trên CẢ 3 đường ghi nhóm
   (assignLclCostGroup · updateLclCostGroup · updateLclTruck) — lỗi cùng class chặn tại owner.
2. FE dialog (`LclGroupTruckEditDialog.tsx`): đường nhập tay chỉ nhận BKS thật
   (regex BKS VN `NN{2}[A-Z]{1,2}-NNNN|NNNNN|NNN.NN`) hoặc BKS đã có trong danh mục đội xe;
   "Bổ sung sau" (mọi biến thể) bị từ chối kèm lý do "tạm hoãn chỉ dùng trên lô đơn".
   Giá trị lưu được canonical hoá (`30k 123.45` → `30K-123.45`).
3. BE stale identity (QA note 4 — `99H-004.59` sống sót sau defer ở fulfillment layer):
   khi một dòng kế hoạch RỚT biển (defer/Bỏ gán/đổi nhà xe chưa gán xe mới) tại
   `dispatch-planning-detail-plan.service.ts`, lô đứng NGOÀI nhóm COST được xoá
   `shipments.actualTruckNo` (luật FB-094 "cleared plate ⇒ blank"); nhóm còn ghép giữ nguyên
   bản sắc chung. Ba điểm ghi đều được phủ: atomic plan save (gộp vào block shipment write
   có guard version), legacy `/plate`, đổi nhà xe.

### Test pin

- FE `LclGroupTruckEditDialog.test.tsx`: gõ "Bổ sung sau" (biến thể) → rejected `role=alert`
  "không phải biển số", không wire; chuỗi rác → rejected "định dạng biển số Việt Nam";
  BKS thật gõ mới → OK, canonical `30K-123.45`; BKS trong danh mục → OK.
- BE `backend/src/tests/unit/lcl-group-plate-defer-guard.test.ts`: schema chặn literal + biến thể
  trên 3 schema; source-scan 3 điểm rớt biển gọi `clearStaleLotActualTruck`, guard nhóm COST,
  plan save gộp reset vào block version-guard.

### Coverage còn lại

- Chưa drive UI thật luồng dispatch nhóm (cần lô ghép + vai trò ĐV trên môi trường có dữ liệu
  phù hợp) — luật chặn được pin ở mức component test + wire contract; BE stale-reset được
  source-scan pin, chưa có integration probe DB (thuộc lớp qa/scripts nếu QA yêu cầu).
