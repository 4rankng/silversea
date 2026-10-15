-- FB-090 LCL foundation — Loại xe tải trọng tải + bảng giá thu/trả theo
-- trọng tải (DEV SPEC Hàng lẻ 2026.10.15 §I + §II.1).
--
-- Hand-written migration (same precedent as 20261014103000_driver_timesheet:
-- the drizzle-kit snapshot chain has a pre-existing parent-snapshot
-- collision, so an explicit SQL file plus a journal entry is the house way).
--
-- Part 1 — pricing_tables.vehicle_size_class_id: structured link into the
-- existing vehicle_size_classes catalog (1.25T…15T + CONT20/40, already
-- seeded by the freight-engine work). The write path denormalizes
-- rate_key = the class code, so rows keep landing in the existing
-- rate-key partial unique index and every legacy rateKey resolver (freight
-- engine, resolveTablePrice, seed scripts, snapshots) works unchanged.
-- The backfill below links legacy rows whose rate_key already equals a
-- catalog code (the freight-engine seeds wrote exactly those codes).
ALTER TABLE "pricing_tables" ADD COLUMN "vehicle_size_class_id" integer;
--> statement-breakpoint
UPDATE "pricing_tables" pt
SET "vehicle_size_class_id" = vsc."id"
FROM "vehicle_size_classes" vsc
WHERE pt."rate_key" = vsc."code"
  AND pt."vehicle_size_class_id" IS NULL;
--> statement-breakpoint
CREATE INDEX "pricing_tables_vehicle_class_idx" ON "pricing_tables" USING btree ("vehicle_size_class_id");
--> statement-breakpoint
-- Part 2 — carrier_route_pricing: Bảng giá cước trả nhà xe theo
-- (tuyến × loại xe × [nhà xe]). supplier_id NULL = "giá chung" cho mọi nhà
-- xe chưa có giá riêng; supplier_id set = giá riêng của nhà xe đó. Lookup
-- cascade (pricing.service): giá riêng → giá chung. Two partial unique
-- indexes keep each lane single-priced per effectiveDate — NULL supplier
-- rows need their own index because Postgres UNIQUE treats NULLs as
-- distinct. deleted_at is part of the predicate (soft-deleted rows free
-- the lane for re-creation), matching port_zone_surcharges.
CREATE TABLE "carrier_route_pricing" (
	"id" serial PRIMARY KEY NOT NULL,
	"route_id" integer NOT NULL,
	"vehicle_size_class_id" integer NOT NULL,
	"supplier_id" integer,
	"price" numeric(15, 0) NOT NULL,
	"effective_date" date DEFAULT now() NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX "carrier_route_pricing_generic_date_uniq" ON "carrier_route_pricing" USING btree ("route_id", "vehicle_size_class_id", "effective_date") WHERE ("supplier_id" is null and "deleted_at" is null);
--> statement-breakpoint
CREATE UNIQUE INDEX "carrier_route_pricing_supplier_date_uniq" ON "carrier_route_pricing" USING btree ("route_id", "vehicle_size_class_id", "supplier_id", "effective_date") WHERE ("supplier_id" is not null and "deleted_at" is null);
