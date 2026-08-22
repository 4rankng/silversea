-- Custom SQL migration file, put your code below! --
-- Shipments created before the cargo_mode classification column exist (and
-- seed data predating it) still carry NULL. Every decompose path (CUS
-- container saves, dispatch planning, intake) rejects those rows with
-- "Hình thức hàng FCL/LCL chưa được xác định." A shipment that owns
-- containers can only be FCL (LCL cannot own containers); a shipment without
-- containers must be LCL (FCL decompose requires at least one container).
UPDATE "shipments" AS shipment
SET "cargo_mode" = 'FCL'
WHERE shipment."cargo_mode" IS NULL
  AND EXISTS (
    SELECT 1 FROM "shipment_containers" AS container
    WHERE container."shipment_id" = shipment."id"
  );
--> statement-breakpoint
UPDATE "shipments" AS shipment
SET "cargo_mode" = 'LCL'
WHERE shipment."cargo_mode" IS NULL;
--> statement-breakpoint
-- Repeat the 0031 container-route backfill for containers that missed it only
-- because their shipment's cargo_mode was still NULL when 0031 ran. The
-- restrictive predicate keeps reruns harmless.
UPDATE "shipment_containers" AS container
SET "route_id" = shipment."route_id"
FROM "shipments" AS shipment
WHERE container."shipment_id" = shipment."id"
  AND container."route_id" IS NULL
  AND shipment."cargo_mode" = 'FCL'
  AND shipment."route_id" IS NOT NULL;
