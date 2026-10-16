-- Card 161026121500 — "bảng giá xóa rồi thêm lại báo trùng ảo" (phantom
-- duplicate after delete + re-add), sweep of the whole defect family.
--
-- Root cause: the pricing-catalog CRUD soft-deletes rows (deletedAt
-- tombstone) and every app-level duplicate guard in catalog-crud.routes
-- filters isNull(deletedAt), but five unique indexes still counted
-- tombstones in their key slot. Deleting a bảng giá then re-adding the
-- same selector passed the guard and then failed the INSERT on the index
-- still occupied by the deleted row. carrier_route_pricing (20261015103000)
-- and port_zone_surcharges already had the tombstone predicate — these
-- five are aligned to that standard.
--
-- Safety: every recreated index only WEAKENS its constraint (tombstones
-- leave the key space), so no live data can violate the new predicates —
-- no backfill needed. Catalog tables are small; DROP + CREATE takes a
-- brief lock (acceptable for local dev; on deploy run in one transaction
-- per drizzle migrate as usual). Rollback = recreate the old definitions;
-- that only fails if tombstones sharing a key have accumulated since —
-- delete those duplicates-by-design first.
DROP INDEX IF EXISTS "pricing_tables_general_date_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX "pricing_tables_general_date_idx" ON "pricing_tables" USING btree ("customer_id","route_id","effective_date") WHERE "pricing_tables"."container_type_id" is null and "pricing_tables"."rate_key" is null and "pricing_tables"."deleted_at" is null;
--> statement-breakpoint
DROP INDEX IF EXISTS "pricing_tables_container_date_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX "pricing_tables_container_date_idx" ON "pricing_tables" USING btree ("customer_id","route_id","container_type_id","effective_date") WHERE "pricing_tables"."container_type_id" is not null and "pricing_tables"."rate_key" is null and "pricing_tables"."deleted_at" is null;
--> statement-breakpoint
DROP INDEX IF EXISTS "pricing_tables_rate_key_date_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX "pricing_tables_rate_key_date_idx" ON "pricing_tables" USING btree ("customer_id","route_id","rate_key","effective_date") WHERE "pricing_tables"."container_type_id" is null and "pricing_tables"."rate_key" is not null and "pricing_tables"."deleted_at" is null;
--> statement-breakpoint
DROP INDEX IF EXISTS "road_allowances_route_type_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX "road_allowances_route_type_idx" ON "road_allowances" USING btree ("route_id","trailer_type") WHERE "road_allowances"."deleted_at" is null;
--> statement-breakpoint
DROP INDEX IF EXISTS "lift_pricing_port_type_state_dir_date_uniq";
--> statement-breakpoint
CREATE UNIQUE INDEX "lift_pricing_port_type_state_dir_date_uniq" ON "lift_pricing" USING btree ("port_id","container_type_id","direction","load_state","effective_date") WHERE "lift_pricing"."deleted_at" is null;
