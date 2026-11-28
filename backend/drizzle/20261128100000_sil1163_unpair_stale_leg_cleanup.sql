-- SIL-1163 (K3.50) — dọn dữ liệu bỏ lại từ các lần Hủy ghép Kẹp/Kết hợp
-- TRƯỚC khi fix 557f51e6 lên build: lần hủy ghép đó gỡ xe/kéo (truck_id,
-- trailer_id = null) nhưng KHÔNG gỡ tài xế (driver_id còn nguyên) và không
-- reset snapshot biển số kế hoạch (shipment_fulfillments.planned_vehicle_
-- plate_number) — nên /dispatch-detail vẫn hiện xe + tài xế chung cho cả 2
-- lệnh sau hủy ghép (QA deb08aa9: chuyến 685, cont RCHK0000020 vẫn đọc
-- 15H-104.03 + Bùi Tiến Dũng từ fulfillment 1289). Code hiện hành đã gỡ đủ
-- driver + snapshot cho lần hủy ghép TỚI (cùng transaction với unpair);
-- migration này chỉ sửa lớp dữ liệu CŨ, đúng class "chân 2 của cặp đã
-- BROKEN/UNPAIRED đã mất xe nhưng còn giữ tài xế". Chạy lại an toàn nhờ
-- guard IS NOT NULL / IS NULL.
UPDATE "trips" SET "driver_id" = NULL, "version" = "trips"."version" + 1, "updated_at" = now()
FROM "trip_pairs"
WHERE "trip_pairs"."status" = 'BROKEN'
  AND "trip_pairs"."break_reason" = 'UNPAIRED'
  AND "trip_pairs"."second_trip_id" = "trips"."id"
  AND "trips"."truck_id" IS NULL
  AND "trips"."driver_id" IS NOT NULL
  AND "trips"."deleted_at" IS NULL;--> statement-breakpoint
UPDATE "shipment_fulfillments" SET "planned_vehicle_plate_number" = NULL
FROM "trip_pairs"
INNER JOIN "trips" ON "trips"."id" = "trip_pairs"."second_trip_id"
WHERE "trip_pairs"."status" = 'BROKEN'
  AND "trip_pairs"."break_reason" = 'UNPAIRED'
  AND "trips"."truck_id" IS NULL
  AND "trips"."deleted_at" IS NULL
  AND "trips"."fulfillment_id" = "shipment_fulfillments"."id"
  AND "shipment_fulfillments"."planned_vehicle_plate_number" IS NOT NULL;
