# Case: card 211026152138 — Kẹp bị block "Thiếu thông tin tải trọng xe" khi xe chưa khai tải trọng

- Case ID: 2026-10-21-card211026152138
- Reported: 21/10/2026 15:21 (R31 batch, điều vận, local)
- Status: FIXED (branch fix-r31-kep-am)

## Reproduction (pre-fix)

1. Điều vận mở Kế hoạch chi tiết, ghép 2 lệnh cont 20' (dialog "Ghép chuyến điều vận", loại Kẹp).
2. Đầu kéo/moóc của lệnh chưa khai tải trọng (master-data import để trống Loại Moóc → `trips.vehicle_capacity_kg` NULL vì `inferredVehicleCapacityKg(null)` trả null).
3. Hệ thống chặn: 422 `Thiếu thông tin tải trọng xe` (backend `createTripPair` → `MISSING_CAPACITY`); phía FE `PairTripsDialog.draftFor` còn chặn sớm hơn với "Chuyến thiếu lịch kế hoạch / điểm đi đến / khối lượng — bổ sung trước khi ghép." khi `vehicleCapacityKg` null.

Expected (PRD LoHangKepKetHop §1.1/§7.2 — luật nói rõ việc TỪ CHỐI khi tổng trọng lượng VƯỢT năng lực, nhưng KHÔNG định nghĩa behavior khi capacity CHƯA KHAI): không block — cảnh báo soft kèm cho phép tiếp tục (phương án (b) của brief, do PRD không nói rõ). Khi capacity CÓ khai báo, vượt tải vẫn chặn giữ nguyên.

## Root cause

`backend/src/services/trip-pairs.service.ts` `createTripPair` throw `MISSING_CAPACITY` khi `vehicleCapacityKg` null trên một trong hai chuyến; `buildTripPairSnapshot` cũng push `MISSING_CAPACITY` vào blockingCodes. FE `PairTripsDialog.draftFor` yêu cầu `trip.vehicleCapacityKg` truthy mới cho submit.

## Fix + regression pins

- `buildTripPairSnapshot`: thiếu capacity không còn là blocking code (không chứng minh được quá tải — cùng luật với luồng phát lệnh `assertResourceAvailability` vốn chỉ chặn khi `vehicleCapacityKg != null`). OVERLOAD vẫn chặn khi capacity có khai.
- `createTripPair`: bỏ throw; khi thiếu capacity → bỏ qua check thống nhất tải trọng, tạo cặp và trả `warnings[]` "Xe chưa khai tải trọng trong danh mục — không đối chiếu được tổng trọng lượng cặp…".
- FE `PairTripsDialog.draftFor`: cho phép `vehicleCapacityKg: null` (schema `tripPairDraftSchema.vehicleCapacityKg` nhận nullable).

Pinned by `backend/src/tests/o01-trip-pairing.service.test.ts` (thiếu capacity → eligible; có capacity + quá tải → vẫn block) và `frontend/src/features/dispatch/detailed-plan/PairTripsDialog.test.tsx` (trip null-capacity vẫn submit với `vehicleCapacityKg: null`).
