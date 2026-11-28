# SIL-1163 (id 1339) — Hủy ghép cặp Kẹp: chân 2 phải rỗng xe + tài xế + snapshot kế hoạch (regression case)

Case ID: TC-SIL-1163-01
Feature: Hủy ghép (POST /api/trips/pairs/:id/unpair) trên /dispatch-detail — lịch xe không chồng (KB Ch.3 §3.3.5 K3.50).

## Repro (QA staging build 2881141d/deb08aa9, 27–28/11/2026)
1. Hai chuyến ghép cặp Kẹp 67 (lô SHP-2611-00862, Bill R4CHK1B-FCL01): 683 + 685, cùng xe 15H-104.03 + tài xế Bùi Tiến Dũng, cùng khung 08:00.
2. Điều vận mở menu dòng RCHK0000020 → "Hủy ghép" → xác nhận (unpair 200).
3. Tải lại /dispatch-detail?date=2026-11-28.

## Expected
- Cả 2 lệnh nhãn Đơn; dòng lệnh 2 (685) KHÔNG còn biển số/tài xế — hiện "Chưa phân xe" (trả xe về chờ phân công, giữ giờ hẹn).
- GET /api/trips/685 → truckId null, trailerId null, driverId null.
- GET /api/shipments/dispatch-detail-plan-rows → fulfillment 1289 không còn assignedPlate/assignedDriverName (snapshot plannedVehiclePlateNumber = null).
- Nhật ký audit đúng sự kiện TRIP_PAIR_UNPAIRED, không nêu mã chuyến lạ (pair id không enrich qua bảng trips).
- Unpair lại → 409 "Cặp ghép này đã được gỡ trước đó." (không nhân đôi hoàn tác).

## Lớp lỗi + sửa
- Hành vi TỚI: fix 557f51e6 (trên main) — unpair gỡ CẢ driver_id + reset plannedVehiclePlateNumber trong cùng transaction; audit event riêng TRIP_PAIR_UNPAIRED + suffix registration + enrichment guard 'trip-pairs'.
- Dữ liệu CŨ (lần hủy ghép TRƯỚC fix — QA fail 28/11 deb08aa9: trip 685 driverId vẫn 16, fulfillment 1289 vẫn plate): migration `backend/drizzle/20261128100000_sil1163_unpair_stale_leg_cleanup.sql` — đúng class "chân 2 của trip_pairs BROKEN/UNPAIRED, truck_id IS NULL nhưng driver_id/planned_vehicle_plate_number còn", idempotent.

## Pins
- Backend hành vi tại `trip-pairs.service.ts` (khối SIL-1163 trong unpairTripPairInTx) — driver release + snapshot reset; audit: `backend/src/index.ts` registerAuditEvent TRIP_PAIR_UNPAIRED + `audit.service.ts` enrichment guard.
- Migration = data repair (không unit-pin); QA verify trên staging sau deploy + migrate: dòng 685 đọc "Chưa phân xe", grid không còn 2 dòng cùng xe cùng khung.

## Not covered
- UI DRIVEN (rung 3): QA chạy trên staging sau khi orchestrator deploy + chạy migrate.
- Đường ghép LẠI sau hủy ghép (QA hỏi): ghép lại cần cả 2 lệnh cùng biển số (luật BE) — lệnh 2 mất xe đúng thiết kế; việc tái phân xe cho chuyến đã phát lệnh (409 "Không thể sửa kế hoạch sau khi đã phát hành lệnh điều xe") là luồng sản phẩm riêng, không thuộc ticket này.
