-- FB-092 LCL lot grouping — cost group + virtual truck (DEV SPEC Hàng lẻ
-- 2026.10.15 §II.2.2; kanban FB-092).
--
-- Hand-written migration, same precedent as 20261015103000_lcl_vehicle_pricing
-- (explicit SQL file + journal entry is the house way; the drizzle-kit snapshot
-- chain has a pre-existing parent-snapshot collision).
--
-- All columns land on `shipments` because the lô — not the trip — is the unit
-- every surface (dispatch, CUS settlement, accounting debit) already reads.
-- The COST group (cước trả ĐV, dispatch) groups here: `cost_group_order` 1 is
-- the principal lot carrying 100% of the vendor freight; members 2..N carry
-- 0₫ (their live trip's external_freight_cost is zeroed by the grouping
-- service). The REV group (cước thu khách) lands with FB-093.
--
-- No FK on cost_vehicle_class_id: cross-file integer link declared in the
-- application service, matching trips.activeTripPairId's house pattern.
ALTER TABLE "shipments" ADD COLUMN "cost_group_id" varchar(36);
--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "cost_group_order" integer;
--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "actual_truck_no" varchar(20);
--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "billing_truck_no" varchar(20);
--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "cost_vehicle_class_id" integer;
--> statement-breakpoint
CREATE INDEX "shipments_cost_group_idx" ON "shipments" USING btree ("cost_group_id");
