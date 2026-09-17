CREATE TABLE "expense_accounting_evidence" (
	"id" serial PRIMARY KEY NOT NULL,
	"expense_accounting_source_id" integer NOT NULL,
	"storage_key" text NOT NULL,
	"uploaded_by_id" integer NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_accounting_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"shipment_id" integer NOT NULL,
	"trip_id" integer,
	"recorded_by_id" integer,
	"confirmed_by_id" integer,
	"confirmed_at" timestamp with time zone,
	"linked_trip_expense_id" integer,
	"reconciliation_id" integer,
	"allocated_advance_amount" numeric(15, 0) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'RECORDED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_cash_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"voucher_id" integer NOT NULL,
	"expense_accounting_source_id" integer NOT NULL,
	"payment_allocation_id" integer,
	"source_version" integer NOT NULL,
	"amount" numeric(15, 0) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_cash_vouchers" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"counterparty_type" text NOT NULL,
	"counterparty_id" integer NOT NULL,
	"payment_receipt_id" integer,
	"treasury_movement_id" integer NOT NULL,
	"reconciliation_id" integer,
	"status" text DEFAULT 'RECORDED' NOT NULL,
	"note" text,
	"created_by_id" integer NOT NULL,
	"reversed_by_id" integer,
	"reversal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_reconciliation_advances" (
	"id" serial PRIMARY KEY NOT NULL,
	"reconciliation_id" integer NOT NULL,
	"advance_request_id" integer NOT NULL,
	"amount" numeric(15, 0) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_reconciliations" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"ops_user_id" integer NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"amount" numeric(15, 0) NOT NULL,
	"advance_amount" numeric(15, 0) NOT NULL,
	"note" text,
	"created_by_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "truck_accountant_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"truck_id" integer NOT NULL,
	"accountant_id" integer,
	"version" integer NOT NULL,
	"assigned_by_id" integer NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "container_deposit_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"shipment_id" integer NOT NULL,
	"bill_number" varchar(100) NOT NULL,
	"shipping_line_name" varchar(255) NOT NULL,
	"amount" numeric(15, 0) NOT NULL,
	"deposit_date" date NOT NULL,
	"documents_submitted_date" date,
	"refund_received_date" date,
	"recovered_amount" numeric(15, 0) DEFAULT '0' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"note" text,
	"created_by" integer NOT NULL,
	"updated_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_invoice_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"shipment_id" integer NOT NULL,
	"supplier_id" integer NOT NULL,
	"invoice_number" varchar(100) NOT NULL,
	"invoice_date" date NOT NULL,
	"face_amount" numeric(15, 0) NOT NULL,
	"supplier_fee_amount" numeric(15, 0) NOT NULL,
	"source_expense_id" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"note" text,
	"created_by" integer NOT NULL,
	"updated_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP VIEW "public"."trips_composite";--> statement-breakpoint
ALTER TABLE "trip_financial_state" ADD COLUMN "reconciled_toll_cost" numeric(15, 0);--> statement-breakpoint
ALTER TABLE "trip_financial_state" ADD COLUMN "reconciled_extra_cost" numeric(15, 0) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "driver_incidental_costs" ADD COLUMN "payer_kind" text;--> statement-breakpoint
ALTER TABLE "driver_incidental_costs" ADD COLUMN "cost_group" text;--> statement-breakpoint
ALTER TABLE "driver_incidental_costs" ADD COLUMN "fee_name" text;--> statement-breakpoint
ALTER TABLE "driver_incidental_costs" ADD COLUMN "customer_charge_amount" numeric(15, 0);--> statement-breakpoint
ALTER TABLE "driver_incidental_costs" ADD COLUMN "invoice_number" text;--> statement-breakpoint
ALTER TABLE "driver_incidental_costs" ADD COLUMN "invoice_date" date;--> statement-breakpoint
ALTER TABLE "driver_incidental_costs" ADD COLUMN "recovery_note" text;--> statement-breakpoint
ALTER TABLE "driver_incidental_costs" ADD COLUMN "photo_storage_keys" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "trip_expenses" ADD COLUMN "cost_group" text;--> statement-breakpoint
ALTER TABLE "trip_expenses" ADD COLUMN "fee_name" text;--> statement-breakpoint
ALTER TABLE "trip_expenses" ADD COLUMN "recovery_note" text;--> statement-breakpoint
ALTER TABLE "ops_expense_entries" ADD COLUMN "payer_kind" text;--> statement-breakpoint
ALTER TABLE "ops_expense_entries" ADD COLUMN "cost_group" text;--> statement-breakpoint
ALTER TABLE "ops_expense_entries" ADD COLUMN "fee_name" text;--> statement-breakpoint
ALTER TABLE "ops_expense_entries" ADD COLUMN "customer_charge_amount" numeric(15, 0);--> statement-breakpoint
ALTER TABLE "ops_expense_entries" ADD COLUMN "invoice_number" text;--> statement-breakpoint
ALTER TABLE "ops_expense_entries" ADD COLUMN "invoice_date" date;--> statement-breakpoint
ALTER TABLE "ops_expense_entries" ADD COLUMN "recovery_note" text;--> statement-breakpoint
ALTER TABLE "ops_expense_entries" ADD COLUMN "photo_storage_keys" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "expense_accounting_evidence_key_uniq" ON "expense_accounting_evidence" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "expense_accounting_evidence_source_idx" ON "expense_accounting_evidence" USING btree ("expense_accounting_source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_accounting_source_uniq" ON "expense_accounting_sources" USING btree ("source_kind","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_accounting_trip_expense_uniq" ON "expense_accounting_sources" USING btree ("linked_trip_expense_id") WHERE "expense_accounting_sources"."linked_trip_expense_id" is not null;--> statement-breakpoint
CREATE INDEX "expense_accounting_shipment_idx" ON "expense_accounting_sources" USING btree ("shipment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_cash_allocations_pair_uniq" ON "expense_cash_allocations" USING btree ("voucher_id","expense_accounting_source_id");--> statement-breakpoint
CREATE INDEX "expense_cash_allocations_source_idx" ON "expense_cash_allocations" USING btree ("expense_accounting_source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_cash_vouchers_code_uniq" ON "expense_cash_vouchers" USING btree ("code");--> statement-breakpoint
CREATE INDEX "expense_cash_vouchers_created_idx" ON "expense_cash_vouchers" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_reconciliation_advances_pair_uniq" ON "expense_reconciliation_advances" USING btree ("reconciliation_id","advance_request_id");--> statement-breakpoint
CREATE INDEX "expense_reconciliation_advances_advance_idx" ON "expense_reconciliation_advances" USING btree ("advance_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_reconciliations_code_uniq" ON "expense_reconciliations" USING btree ("code");--> statement-breakpoint
CREATE INDEX "expense_reconciliations_user_idx" ON "expense_reconciliations" USING btree ("ops_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "truck_accountant_assignments_active_uniq" ON "truck_accountant_assignments" USING btree ("truck_id") WHERE "truck_accountant_assignments"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "truck_accountant_assignments_user_idx" ON "truck_accountant_assignments" USING btree ("accountant_id");--> statement-breakpoint
CREATE INDEX "container_deposit_records_shipment_idx" ON "container_deposit_records" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "container_deposit_records_date_idx" ON "container_deposit_records" USING btree ("deposit_date");--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_invoice_records_identity_uniq" ON "shipment_invoice_records" USING btree ("shipment_id","supplier_id","invoice_number");--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_invoice_records_source_expense_uniq" ON "shipment_invoice_records" USING btree ("source_expense_id");--> statement-breakpoint
CREATE INDEX "shipment_invoice_records_date_idx" ON "shipment_invoice_records" USING btree ("invoice_date","shipment_id");--> statement-breakpoint
CREATE VIEW "public"."trips_composite" AS (
  select
    trips.id, trips.trip_code, trips.version, trips.created_by, trips.customer_id,
    trips.customer_reference, trips.truck_id, trips.driver_id, trips.route_id,
    trips.trailer_id, trips.trailer_type, trips.cargo_type_id, trips.container_count,
    trips.status, trips.departure_date, trips.planned_start_at, trips.planned_end_at,
    trips.canonical_origin, trips.canonical_destination, trips.cargo_weight_kg,
    trips.vehicle_capacity_kg, trips.active_trip_pair_id, trips.active_trip_pair_order,
    trips.fuel_mode, trips.fuel_liters_override, trips.fuel_supplement_liters,
    trips.fuel_supplement_reason, trips.tolls_discount, trips.tolls_addition,
    trips.tolls_stations, trips.has_return_cargo, trips.notes, trips.cost_submission_note,
    trips.shipment_id, trips.fulfillment_id, trips.source_shipment_version,
    trips.completed_at, trips.pod_recovered_at, trips.pod_recovered_by,
    trips.paper_order_collected_at, trips.paper_order_collected_by,
    trips.instruction_contact_name, trips.instruction_contact_phone,
    trips.instruction_notes, trips.created_at, trips.updated_at, trips.deleted_at,
    trip_financial_state.driver_salary, trip_financial_state.fuel_price_applied,
    trip_financial_state.fuel_actual_unit_price, trip_financial_state.road_allowance_base_applied,
    trip_financial_state.fuel_loaded_norm_applied, trip_financial_state.fuel_empty_norm_applied,
    trip_financial_state.fuel_fixed_allowance_applied, trip_financial_state.fuel_supplement_norm_applied,
    trip_financial_state.toll_per_station_applied, trip_financial_state.return_cargo_bonus_applied,
    trip_financial_state.fuel_liters, trip_financial_state.total_fuel_cost,
    trip_financial_state.fuel_surcharge_amount, trip_financial_state.fuel_surcharge_snapshot,
    trip_financial_state.fuel_surcharge_snapshot_dirty, trip_financial_state.total_road_allowance,
    trip_financial_state.toll_cost, trip_financial_state.reconciled_toll_cost, trip_financial_state.reconciled_extra_cost, trip_financial_state.toll_deduction,
    trip_financial_state.road_allowance_override, trip_financial_state.total_cost,
    trip_financial_state.revenue, trip_financial_state.revenue_empty_return,
    trip_financial_state.revenue_combine, trip_financial_state.two_point_delivery_bonus,
    trip_financial_state.vehicle_shift_allowance, trip_financial_state.gross_profit,
    trip_financial_state.revenue_original, trip_financial_state.revenue_overridden_by,
    trip_financial_state.revenue_overridden_at, trip_financial_state.revenue_override_reason,
    trip_financial_state.pricing_source, trip_financial_state.pricing_formula,
    trip_financial_state.pricing_snapshot, trip_financial_state.customer_commission,
    trip_financial_state.trip_wage_days, trip_financial_state.fuel_supplier_id,
    trip_financial_state.vat_rate, trip_financial_state.ar_cost_hash,
    trip_financial_state.ar_snapshot_dirty, trip_financial_state.ar_snapshot_changed_at,
    trip_financial_state.ap_cost_hash, trip_financial_state.ap_snapshot_dirty,
    trip_financial_state.ap_snapshot_changed_at, trip_financial_state.pnl_snapshot_gross_profit,
    trip_carrier_info.carrier_type, trip_carrier_info.external_entity_id,
    trip_carrier_info.external_entity_type, trip_carrier_info.external_freight_cost,
    trip_carrier_info.external_plate_number, trip_carrier_info.external_carrier_vehicle_id,
    trip_carrier_info.external_driver_name, trip_carrier_info.external_driver_phone
  from trips
  left join trip_financial_state on trip_financial_state.trip_id = trips.id
  left join trip_carrier_info on trip_carrier_info.trip_id = trips.id
);