-- Each active factory may identify exactly one canonical FCL route. This is
-- nullable for warehouses and existing factories: historical data does not
-- contain a safe route mapping to backfill. New factory writes require it,
-- and container reconciliation validates the route remains active.
ALTER TABLE "operational_sites" ADD COLUMN "route_id" integer;
--> statement-breakpoint
CREATE INDEX "operational_sites_route_idx" ON "operational_sites" USING btree ("route_id");
