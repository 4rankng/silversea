-- Stage D straggler backfill: trips created by pre-split code after the Stage A
-- backfill (0054) lack sidecar rows. Copy their values verbatim BEFORE the
-- columns drop — zero data loss. Idempotent (NOT EXISTS guard).
INSERT INTO "trip_financial_state" ("trip_id","driver_salary","fuel_price_applied","fuel_actual_unit_price","road_allowance_base_applied","fuel_loaded_norm_applied","fuel_empty_norm_applied","fuel_fixed_allowance_applied","fuel_supplement_norm_applied","toll_per_station_applied","return_cargo_bonus_applied","fuel_liters","total_fuel_cost","fuel_surcharge_amount","fuel_surcharge_snapshot","fuel_surcharge_snapshot_dirty","total_road_allowance","toll_cost","toll_deduction","road_allowance_override","total_cost","revenue","revenue_empty_return","revenue_combine","two_point_delivery_bonus","vehicle_shift_allowance","gross_profit","revenue_original","revenue_overridden_by","revenue_overridden_at","revenue_override_reason","pricing_source","pricing_formula","pricing_snapshot","customer_commission","trip_wage_days","fuel_supplier_id","vat_rate","ar_cost_hash","ar_snapshot_dirty","ar_snapshot_changed_at","ap_cost_hash","ap_snapshot_dirty","ap_snapshot_changed_at","pnl_snapshot_gross_profit")
SELECT "t"."id","t"."driver_salary","t"."fuel_price_applied","t"."fuel_actual_unit_price","t"."road_allowance_base_applied","t"."fuel_loaded_norm_applied","t"."fuel_empty_norm_applied","t"."fuel_fixed_allowance_applied","t"."fuel_supplement_norm_applied","t"."toll_per_station_applied","t"."return_cargo_bonus_applied","t"."fuel_liters","t"."total_fuel_cost","t"."fuel_surcharge_amount","t"."fuel_surcharge_snapshot","t"."fuel_surcharge_snapshot_dirty","t"."total_road_allowance","t"."toll_cost","t"."toll_deduction","t"."road_allowance_override","t"."total_cost","t"."revenue","t"."revenue_empty_return","t"."revenue_combine","t"."two_point_delivery_bonus","t"."vehicle_shift_allowance","t"."gross_profit","t"."revenue_original","t"."revenue_overridden_by","t"."revenue_overridden_at","t"."revenue_override_reason","t"."pricing_source","t"."pricing_formula","t"."pricing_snapshot","t"."customer_commission","t"."trip_wage_days","t"."fuel_supplier_id","t"."vat_rate","t"."ar_cost_hash","t"."ar_snapshot_dirty","t"."ar_snapshot_changed_at","t"."ap_cost_hash","t"."ap_snapshot_dirty","t"."ap_snapshot_changed_at","t"."pnl_snapshot_gross_profit"
FROM "trips" "t"
WHERE NOT EXISTS (SELECT 1 FROM "trip_financial_state" "f" WHERE "f"."trip_id" = "t"."id");--> statement-breakpoint
INSERT INTO "trip_carrier_info" ("trip_id","carrier_type","external_entity_id","external_entity_type","external_freight_cost","external_plate_number","external_carrier_vehicle_id","external_driver_name","external_driver_phone")
SELECT "t"."id","t"."carrier_type","t"."external_entity_id","t"."external_entity_type","t"."external_freight_cost","t"."external_plate_number","t"."external_carrier_vehicle_id","t"."external_driver_name","t"."external_driver_phone"
FROM "trips" "t"
WHERE NOT EXISTS (SELECT 1 FROM "trip_carrier_info" "c" WHERE "c"."trip_id" = "t"."id");--> statement-breakpoint
DROP INDEX "trips_external_carrier_vehicle_idx";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "driver_salary";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "fuel_price_applied";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "fuel_actual_unit_price";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "road_allowance_base_applied";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "fuel_loaded_norm_applied";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "fuel_empty_norm_applied";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "fuel_fixed_allowance_applied";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "fuel_supplement_norm_applied";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "toll_per_station_applied";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "return_cargo_bonus_applied";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "fuel_liters";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "total_fuel_cost";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "fuel_surcharge_amount";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "fuel_surcharge_snapshot";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "fuel_surcharge_snapshot_dirty";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "total_road_allowance";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "toll_cost";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "toll_deduction";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "road_allowance_override";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "total_cost";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "revenue";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "revenue_empty_return";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "revenue_combine";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "two_point_delivery_bonus";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "vehicle_shift_allowance";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "gross_profit";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "revenue_original";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "revenue_overridden_by";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "revenue_overridden_at";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "revenue_override_reason";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "pricing_source";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "pricing_formula";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "pricing_snapshot";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "customer_commission";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "trip_wage_days";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "fuel_supplier_id";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "vat_rate";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "carrier_type";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "external_entity_id";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "external_entity_type";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "external_freight_cost";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "external_plate_number";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "external_carrier_vehicle_id";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "external_driver_name";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "external_driver_phone";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "ar_cost_hash";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "ar_snapshot_dirty";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "ar_snapshot_changed_at";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "ap_cost_hash";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "ap_snapshot_dirty";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "ap_snapshot_changed_at";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "pnl_snapshot_gross_profit";