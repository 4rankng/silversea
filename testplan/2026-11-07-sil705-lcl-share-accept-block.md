# SIL-705 — Cổng lái xe chặn nhận lệnh 2 của chung xe hàng lẻ (LCL share)

- **Case ID:** SIL-705-REG-1
- **Ticket:** plan.tingting.vip SIL-705 (internal id 825) — hàng lẻ không nhập được tờ khai + phân số xe (ảnh 07/11, các dòng LOG COM); brief: "tạo lô LCL kèm tờ khai → không 400" + "lô LCL được phân xe bình thường (nếu có gate chặn thì gỡ đúng phần đó)"
- **Surface:** (a) BE+FE tờ khai LCL; (b) BE — `transitionTripStatus` nhánh IN_TRANSIT với các chân LCL chung rig (driver "Nhận lệnh")
- **Role:** CUS (nhập liệu); DRIVER (nhận lệnh); DISPATCHER (gán xe)

## Phần tờ khai (không 400)

- Trên trunk: tạo lô LCL → ô "Số tờ khai" nằm cùng hàng Số Bill/Booking (SIL-678, `ShipmentCreateIdentitySection.tsx:190-206`) → FE gửi riêng qua `POST /shipments/:id/declarations` (SIL-660, `use-shipment-create-workflow.ts:258-268`) → **201, không 400** (probe `sil716` path B + ctx run 17:27: `create LCL clean -> 779159`, `LCL declaration POST -> 201`).
- Chỉ payload LOT-LEVEL `declarationNumber` trong quick-create (form cũ SIL-521) bị 400 "Trường không được hỗ trợ" — là pin theo owner ruling, FE hiện hành không còn gửi key này.

## Phần cổng lái xe (reproduced + fixed)

### Root cause

Điều vận xếp NHIỀU lô LCL lên 1 xe/ngày: plan-row save cho phép ở tầng warn-once ("Đầu xe… đã được gán cho lô/tác vụ khác trong khung giờ trùng lặp. Vẫn lưu?"), issue gate phát từng chân trên windows rời nhau. Fulfillment LCL_SHIPMENT chỉ được classification `'LCL'` (DB check `shipment_fulfillments_lcl_dispatch_classification_check` + business 409 `dispatch-planning-detail-plan.service.ts:1277`) nên pair-row (SIL-602/631) lẫn declared DOUBLE clamp (SIL-634/704) không bao giờ nhận ra sắp xếp — chân 2 "Nhận lệnh" 409 `Xe đang chạy chuyến…` sau evidence chưa đủ của chân 1. Lệch-hợp-đồng hai gate (plan/issue cho phép, accept chặn) — cùng class SIL-634.

### Reproduction (probe `lcl_share`)

2 lô LCL riêng, cùng xe 42/driver laixe/cùng ngày, windows rời nhau, classification 'LCL', trip_containers không type (mặc định LCL) → phát lệnh cả hai OK → nhận chân A → IN_TRANSIT → nhận chân B.

### Observed

- **FIX-build trước carve** (:3102, run 17:30): chân B **409** `Xe đang chạy chuyến TRP-202610-0072…` — `qa/2026-11-07-lane-r1/sil704-api-lcl_share-FIXED.log` (failures=2).
- **Sau carve SIL-705**: chân B nhận OK, cả hai chân IN_TRANSIT đồng thời (rerun cùng probe).

## Fix

`trip-busy-gate.ts`: thêm `isSameRigLclSharePartner` — exempt busy row `'LCL'` khi chân nhận cũng `'LCL'`, cùng driver, cùng ngày (không bound exactly-1: consolidation xếp >2 lô hợp lệ; capacity là gate issue-time; TC2 giữ nguyên — ĐƠN nhận lên holder LCL vẫn chặn). `trip-status-machine.service.ts`: exempt set `declaredLclExempt` trong busy loop; chọn own classification 1 lần dùng chung cho cả 2 proof.

## Regression coverage

`backend/src/tests/unit/trip-status-machine.test.ts` — describe "SIL-705 declared LCL share": REG + TC2 pins (SINGLE/DOUBLE/COMBINED đổi chiều đều chặn) + driver/day drift + self + wiring pin.
