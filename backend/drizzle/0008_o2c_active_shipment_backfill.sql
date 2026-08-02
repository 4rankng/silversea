INSERT INTO "shipment_status_history" ("shipment_id", "from_status", "to_status", "reason", "changed_at")
SELECT "shipments"."id", 'DISPATCHED', 'IN_TRANSIT',
  'Chuẩn hóa dữ liệu O2C: lô hàng có chuyến đang chạy được ghi nhận đúng trạng thái Đang chạy.', now()
FROM "shipments"
WHERE "shipments"."status" = 'DISPATCHED'
  AND EXISTS (
    SELECT 1 FROM "trips"
    WHERE "trips"."shipment_id" = "shipments"."id"
      AND "trips"."status" = 'IN_TRANSIT'
      AND "trips"."deleted_at" IS NULL
  );--> statement-breakpoint
UPDATE "shipments" SET "status" = 'IN_TRANSIT'
WHERE "shipments"."status" = 'DISPATCHED'
  AND EXISTS (
    SELECT 1 FROM "trips"
    WHERE "trips"."shipment_id" = "shipments"."id"
      AND "trips"."status" = 'IN_TRANSIT'
      AND "trips"."deleted_at" IS NULL
  );
