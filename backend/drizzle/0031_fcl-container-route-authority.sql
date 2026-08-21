-- Custom SQL migration file, put your code below! --
-- FCL route authority moved from shipment to its independently dispatchable
-- container. Keep the column nullable for LCL and old API clients; new FCL
-- intake validates a route for every container before dispatch.
ALTER TABLE "shipment_containers" ADD COLUMN "route_id" integer;
--> statement-breakpoint
CREATE INDEX "shipment_containers_route_idx" ON "shipment_containers" USING btree ("route_id");
--> statement-breakpoint
-- Preserve current operational intent for every legacy FCL container. The
-- restrictive predicate makes reruns harmless and never overwrites a route
-- already assigned directly to a container.
UPDATE "shipment_containers" AS container
SET "route_id" = shipment."route_id"
FROM "shipments" AS shipment
WHERE container."shipment_id" = shipment."id"
  AND container."route_id" IS NULL
  AND shipment."cargo_mode" = 'FCL'
  AND shipment."route_id" IS NOT NULL;
