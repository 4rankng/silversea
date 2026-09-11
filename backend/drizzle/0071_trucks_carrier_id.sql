-- truck-carrier-link (ticket from plans/20261109-truck-carrier-link): a
-- tractor can belong to a nhà xe (carrier customer). Nullable plain integer
-- by convention (no FK — avoids a master-data <-> shipments import cycle);
-- the catalog write path validates the target is an ACTIVE isCarrier
-- customer. Null = xe nhà (own fleet). Additive only, no data change.
ALTER TABLE "trucks" ADD COLUMN "carrier_id" integer;
--> statement-breakpoint
CREATE INDEX "trucks_carrier_idx" ON "trucks" USING btree ("carrier_id");
