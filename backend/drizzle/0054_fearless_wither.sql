-- Trips split Stage A (lean-down; spec: plans/260906-1032-db-lean-down/):
-- additive scaffold for the 99-column trips god-table split. Creates
-- trip_financial_state (44 computed financial/snapshot columns) and
-- trip_carrier_info (8 external-carrier columns), 1:1 per trip, then
-- backfills from trips. Stage A changes NO reader or writer — trips remains
-- the live source until Stage B/C; Stage D drops the moved columns.

CREATE TABLE "trip_carrier_info" (
	"id" serial PRIMARY KEY NOT NULL,
	"trip_id" integer NOT NULL,
	"carrier_type" varchar(20) DEFAULT 'OWN' NOT NULL,
	"external_entity_id" integer,
	"external_entity_type" varchar(20),
	"external_freight_cost" numeric(15, 0),
	"external_plate_number" varchar(20),
	"external_carrier_vehicle_id" integer,
	"external_driver_name" varchar(100),
	"external_driver_phone" varchar(20),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE "trip_financial_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"trip_id" integer NOT NULL,
	"driver_salary" numeric(15, 0),
	"fuel_price_applied" numeric(10, 0),
	"fuel_actual_unit_price" numeric(10, 0),
	"road_allowance_base_applied" numeric(15, 0),
	"fuel_loaded_norm_applied" numeric(6, 2),
	"fuel_empty_norm_applied" numeric(6, 2),
	"fuel_fixed_allowance_applied" numeric(10, 2),
	"fuel_supplement_norm_applied" numeric(6, 2),
	"toll_per_station_applied" numeric(15, 0),
	"return_cargo_bonus_applied" numeric(15, 0),
	"fuel_liters" numeric(10, 2),
	"total_fuel_cost" numeric(15, 0),
	"fuel_surcharge_amount" numeric(15, 0) DEFAULT '0' NOT NULL,
	"fuel_surcharge_snapshot" jsonb,
	"fuel_surcharge_snapshot_dirty" boolean DEFAULT false NOT NULL,
	"total_road_allowance" numeric(15, 0),
	"toll_cost" numeric(15, 0),
	"toll_deduction" numeric(15, 0) DEFAULT '0' NOT NULL,
	"road_allowance_override" numeric(15, 0),
	"total_cost" numeric(15, 0),
	"revenue" numeric(15, 0),
	"revenue_empty_return" numeric(15, 0) DEFAULT '0',
	"revenue_combine" numeric(15, 0) DEFAULT '0',
	"two_point_delivery_bonus" numeric(15, 0) DEFAULT '0',
	"vehicle_shift_allowance" numeric(15, 0) DEFAULT '0',
	"gross_profit" numeric(15, 0),
	"revenue_original" numeric(15, 0),
	"revenue_overridden_by" integer,
	"revenue_overridden_at" timestamp,
	"revenue_override_reason" text,
	"pricing_source" text,
	"pricing_formula" text,
	"pricing_snapshot" jsonb,
	"customer_commission" numeric(15, 0) DEFAULT '0',
	"trip_wage_days" integer,
	"fuel_supplier_id" integer,
	"vat_rate" numeric(5, 3) DEFAULT '0.000' NOT NULL,
	"ar_cost_hash" varchar(64),
	"ar_snapshot_dirty" boolean DEFAULT false NOT NULL,
	"ar_snapshot_changed_at" timestamp with time zone,
	"ap_cost_hash" varchar(64),
	"ap_snapshot_dirty" boolean DEFAULT false NOT NULL,
	"ap_snapshot_changed_at" timestamp with time zone,
	"pnl_snapshot_gross_profit" numeric(15, 0),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE UNIQUE INDEX "trip_carrier_info_trip_id_unq" ON "trip_carrier_info" USING btree ("trip_id");
--> statement-breakpoint

CREATE UNIQUE INDEX "trip_financial_state_trip_id_unq" ON "trip_financial_state" USING btree ("trip_id");
--> statement-breakpoint
INSERT INTO "trip_financial_state" ("trip_id", "driver_salary", "fuel_price_applied", "fuel_actual_unit_price", "road_allowance_base_applied", "fuel_loaded_norm_applied", "fuel_empty_norm_applied", "fuel_fixed_allowance_applied", "fuel_supplement_norm_applied", "toll_per_station_applied", "return_cargo_bonus_applied", "fuel_liters", "total_fuel_cost", "fuel_surcharge_amount", "fuel_surcharge_snapshot", "fuel_surcharge_snapshot_dirty", "total_road_allowance", "toll_cost", "toll_deduction", "road_allowance_override", "total_cost", "revenue", "revenue_empty_return", "revenue_combine", "two_point_delivery_bonus", "vehicle_shift_allowance", "gross_profit", "revenue_original", "revenue_overridden_by", "revenue_overridden_at", "revenue_override_reason", "pricing_source", "pricing_formula", "pricing_snapshot", "customer_commission", "trip_wage_days", "fuel_supplier_id", "vat_rate", "ar_cost_hash", "ar_snapshot_dirty", "ar_snapshot_changed_at", "ap_cost_hash", "ap_snapshot_dirty", "ap_snapshot_changed_at", "pnl_snapshot_gross_profit")
SELECT t."id", "driver_salary", "fuel_price_applied", "fuel_actual_unit_price", "road_allowance_base_applied", "fuel_loaded_norm_applied", "fuel_empty_norm_applied", "fuel_fixed_allowance_applied", "fuel_supplement_norm_applied", "toll_per_station_applied", "return_cargo_bonus_applied", "fuel_liters", "total_fuel_cost", "fuel_surcharge_amount", "fuel_surcharge_snapshot", "fuel_surcharge_snapshot_dirty", "total_road_allowance", "toll_cost", "toll_deduction", "road_allowance_override", "total_cost", "revenue", "revenue_empty_return", "revenue_combine", "two_point_delivery_bonus", "vehicle_shift_allowance", "gross_profit", "revenue_original", "revenue_overridden_by", "revenue_overridden_at", "revenue_override_reason", "pricing_source", "pricing_formula", "pricing_snapshot", "customer_commission", "trip_wage_days", "fuel_supplier_id", "vat_rate", "ar_cost_hash", "ar_snapshot_dirty", "ar_snapshot_changed_at", "ap_cost_hash", "ap_snapshot_dirty", "ap_snapshot_changed_at", "pnl_snapshot_gross_profit" FROM "trips" t
WHERE t."deleted_at" IS NULL
ON CONFLICT ("trip_id") DO UPDATE SET
  "driver_salary" = excluded."driver_salary",
  "fuel_price_applied" = excluded."fuel_price_applied",
  "fuel_actual_unit_price" = excluded."fuel_actual_unit_price",
  "road_allowance_base_applied" = excluded."road_allowance_base_applied",
  "fuel_loaded_norm_applied" = excluded."fuel_loaded_norm_applied",
  "fuel_empty_norm_applied" = excluded."fuel_empty_norm_applied",
  "fuel_fixed_allowance_applied" = excluded."fuel_fixed_allowance_applied",
  "fuel_supplement_norm_applied" = excluded."fuel_supplement_norm_applied",
  "toll_per_station_applied" = excluded."toll_per_station_applied",
  "return_cargo_bonus_applied" = excluded."return_cargo_bonus_applied",
  "fuel_liters" = excluded."fuel_liters",
  "total_fuel_cost" = excluded."total_fuel_cost",
  "fuel_surcharge_amount" = excluded."fuel_surcharge_amount",
  "fuel_surcharge_snapshot" = excluded."fuel_surcharge_snapshot",
  "fuel_surcharge_snapshot_dirty" = excluded."fuel_surcharge_snapshot_dirty",
  "total_road_allowance" = excluded."total_road_allowance",
  "toll_cost" = excluded."toll_cost",
  "toll_deduction" = excluded."toll_deduction",
  "road_allowance_override" = excluded."road_allowance_override",
  "total_cost" = excluded."total_cost",
  "revenue" = excluded."revenue",
  "revenue_empty_return" = excluded."revenue_empty_return",
  "revenue_combine" = excluded."revenue_combine",
  "two_point_delivery_bonus" = excluded."two_point_delivery_bonus",
  "vehicle_shift_allowance" = excluded."vehicle_shift_allowance",
  "gross_profit" = excluded."gross_profit",
  "revenue_original" = excluded."revenue_original",
  "revenue_overridden_by" = excluded."revenue_overridden_by",
  "revenue_overridden_at" = excluded."revenue_overridden_at",
  "revenue_override_reason" = excluded."revenue_override_reason",
  "pricing_source" = excluded."pricing_source",
  "pricing_formula" = excluded."pricing_formula",
  "pricing_snapshot" = excluded."pricing_snapshot",
  "customer_commission" = excluded."customer_commission",
  "trip_wage_days" = excluded."trip_wage_days",
  "fuel_supplier_id" = excluded."fuel_supplier_id",
  "vat_rate" = excluded."vat_rate",
  "ar_cost_hash" = excluded."ar_cost_hash",
  "ar_snapshot_dirty" = excluded."ar_snapshot_dirty",
  "ar_snapshot_changed_at" = excluded."ar_snapshot_changed_at",
  "ap_cost_hash" = excluded."ap_cost_hash",
  "ap_snapshot_dirty" = excluded."ap_snapshot_dirty",
  "ap_snapshot_changed_at" = excluded."ap_snapshot_changed_at",
  "pnl_snapshot_gross_profit" = excluded."pnl_snapshot_gross_profit",
  "updated_at" = now();;
--> statement-breakpoint
INSERT INTO "trip_carrier_info" ("trip_id", "carrier_type", "external_entity_id", "external_entity_type", "external_freight_cost", "external_plate_number", "external_carrier_vehicle_id", "external_driver_name", "external_driver_phone")
SELECT t."id", "carrier_type", "external_entity_id", "external_entity_type", "external_freight_cost", "external_plate_number", "external_carrier_vehicle_id", "external_driver_name", "external_driver_phone" FROM "trips" t
WHERE t."deleted_at" IS NULL
ON CONFLICT ("trip_id") DO UPDATE SET
  "carrier_type" = excluded."carrier_type",
  "external_entity_id" = excluded."external_entity_id",
  "external_entity_type" = excluded."external_entity_type",
  "external_freight_cost" = excluded."external_freight_cost",
  "external_plate_number" = excluded."external_plate_number",
  "external_carrier_vehicle_id" = excluded."external_carrier_vehicle_id",
  "external_driver_name" = excluded."external_driver_name",
  "external_driver_phone" = excluded."external_driver_phone",
  "updated_at" = now();;
