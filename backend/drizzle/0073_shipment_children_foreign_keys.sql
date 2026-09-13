-- Shipment-child foreign keys (tech-debt card 20260913_3): QA/test hard
-- deletes of shipment rows were silently stranding orphan
-- shipment_fulfillments and shipment_containers (154 + 10 found on
-- 2026-09-13; every read path inner-joins shipments, so the orphans were
-- invisible but kept accumulating). The FKs make that structurally
-- impossible:
--   * children CASCADE — deleting a shipment takes its container and
--     fulfillment rows along (the app itself tombstones via deleted_at;
--     hard deletes only happen in tests/QA cleanup).
--   * trips.fulfillment_id RESTRICT — a live trip blocks deleting the
--     fulfillment under it, backing the existing application guard at the
--     database level instead of silently cascading real dispatch work.
-- Pre-checked before shipping: 0 orphans on staging and prod
-- (2026-09-13); local dev databases must be pruned before migrating.
ALTER TABLE "shipment_fulfillments" ADD CONSTRAINT "shipment_fulfillments_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "shipment_containers" ADD CONSTRAINT "shipment_containers_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_fulfillment_id_fkey" FOREIGN KEY ("fulfillment_id") REFERENCES "shipment_fulfillments"("id") ON DELETE RESTRICT;
