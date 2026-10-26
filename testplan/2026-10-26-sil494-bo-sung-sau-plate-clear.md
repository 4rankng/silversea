# SIL-494 — Hồi quy: "Bổ sung sau" phải xóa biển khi lưu (carrier giữ nguyên)

Ngày: 2026-10-26 · SIL-494 (scope còn lại theo QA 25/10: nhánh b) · branch
`fix-554-556-557-dispatch`

## Bug (nhánh b — post-split, đã xác nhận còn fail trên build 7b7180fe)

Trên lô đã tách nhóm, đổi BIỂN SỐ → "Bổ sung sau" (nhà xe giữ nguyên) rồi lưu:
sau reload dòng + dialog vẫn hiện biển cũ. Pattern: chọn "Bổ sung sau" không
bao giờ thay thế biển đang hiển thị.

## Nguyên nhân

`vehicleBody(DEFERRED_PLATE_PREFIX)` trả `{}` — payload KHÔNG có field xe nào.
Backend đọc thiếu vehicle block (carrier không đổi) = "giữ nguyên cột đã lưu"
→ biển cũ sống sót qua save. Comment hàm ghi "plate ships empty" nhưng code
không gửi lệnh clear nào.

## Fix

`vehicleBody('defer:')` → `{ clearVehicle: true }`: carrier type/ID vẫn được
ghi (giữ nguyên), backend resolve `clear: true` ⇒ `planned_vehicle_plate_number`
+ `planned_external_carrier_vehicle_id` = NULL. Lô về AWAITING_PLATE, vẫn phát
lệnh được (card 20261004_359). Lô ĐÃ GHÉP NHÓM vẫn bị chặn tại editor này
(card 191026100010 — BKS là của cả nhóm, đi qua "Đổi BKS nhóm").

## Trường hợp kiểm

| # | Màn hình | Trường hợp |
|---|----------|-----------|
| R1 | Chỉnh sửa điều phối · lô có biển | EXTERNAL + 15C-99999 → "Bổ sung sau" → Lưu ⇒ body `clearVehicle: true`, không plate/vehicle id, carrier giữ; reload ⇒ không còn biển |
| R2 | Như R1 · lô chưa có biển | Chọn "Bổ sung sau" ⇒ idempotent, save OK (null → null) |
| R3 | Lô LCL ĐÃ GHÉP NHÓM | Chọn "Bổ sung sau" ⇒ bị chặn với lý do "Dùng Đổi BKS nhóm", không gọi API save, không gọi updateLclTruck |
| R4 | Phát lệnh | Lô defer sau save vẫn hiện mục Phát lệnh (AWAITING_PLATE issuable) |
| R5 | Nhánh 1 của ticket (đổi nhà xe lô ghép) | ĐÃ FIXED — QA xác nhận 25/10 trên build 7b7180fe, không đụng lại |

## Evidence

- `frontend/src/features/dispatch/detailed-plan/DispatchPlanEditorCell.test.tsx`
  — 81/81 (pin mới: clearVehicle trên wire + repro lô CÓ biển + chặn lô ghép);
  scoped thư mục detailed-plan 40 file / 430 test pass; `tsgo --noEmit` 0.
- API/UI: QA staging retest nhánh b (đổi biển → "Bổ sung sau" → reload).
