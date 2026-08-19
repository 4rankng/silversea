-- Per-container factory authority (SILVER L1): each FCL container may name
-- its own operational site (factory), independent of the shipment-level
-- default. Nullable, indexed; customer-scope + FACTORY-type validity stay
-- application-owned at the persistence choke point — no FK by repo rule.
-- No backfill: legacy rows resolve through the precedence chain
-- (container site -> shipment site -> shipment factory text).
ALTER TABLE "shipment_containers" ADD COLUMN "operational_site_id" integer;--> statement-breakpoint
CREATE INDEX "shipment_containers_operational_site_idx" ON "shipment_containers" USING btree ("operational_site_id");
