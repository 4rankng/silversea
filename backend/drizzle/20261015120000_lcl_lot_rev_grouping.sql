-- FB-093 LCL lot grouping — rev group + loại xe tính cước thu (DEV SPEC Hàng
-- lẻ 2026.10.15 §II.3; kanban FB-093).
--
-- Hand-written migration, same precedent as 20261015110000_lcl_lot_grouping.
-- These columns are the REV dimension (cước thu khách — the CUS settlement
-- side) that FB-092's COST migration deliberately left out:
--   rev_group_order 1 = the principal lot carrying 100% of CƯỚC VẬN TẢI
--   members 2..N      = 0₫ with the reason "Ghép cước cùng Bill X"
--
-- rev_vehicle_class_id is deliberately a SEPARATE link from
-- cost_vehicle_class_id — the spec prices one group at
-- "Thu: Xe 3.5T | Trả: Xe 10T", so the two classes must never alias.
ALTER TABLE "shipments" ADD COLUMN "rev_group_id" varchar(36);
--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "rev_group_order" integer;
--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "rev_vehicle_class_id" integer;
--> statement-breakpoint
CREATE INDEX "shipments_rev_group_idx" ON "shipments" USING btree ("rev_group_id");