CREATE TABLE "debit_note_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"snapshot_id" integer NOT NULL,
	"system_calculated_freight" numeric(15, 0) NOT NULL,
	"final_debit_freight" numeric(15, 0),
	"override_reason" text,
	"override_by" integer,
	"override_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "freight_rate_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"shipment_id" integer,
	"trip_id" integer,
	"freight_amount" numeric(15, 0) NOT NULL,
	"surcharge_amount" numeric(15, 0) NOT NULL,
	"total_amount" numeric(15, 0) NOT NULL,
	"rate_terms_id" integer NOT NULL,
	"pricing_table_id" integer NOT NULL,
	"fuel_norm_id" integer NOT NULL,
	"fuel_price_period_id" integer NOT NULL,
	"billed_km" numeric(10, 2) NOT NULL,
	"liters" numeric(10, 3) NOT NULL,
	"fuel_delta" numeric(12, 4) NOT NULL,
	"share_pct" numeric(5, 2) NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "freight_rate_terms" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"route_id" integer NOT NULL,
	"share_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"billing_km_one_way" integer NOT NULL,
	"billing_km_multiplier" numeric(4, 2) DEFAULT '2' NOT NULL,
	"base_fuel_price" numeric(12, 4) NOT NULL,
	"fuel_lag_days" integer DEFAULT 0 NOT NULL,
	"surcharge_threshold_pct" numeric(5, 2),
	"surcharge_threshold_abs" numeric(12, 2),
	"effective_date" date DEFAULT now() NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "fuel_consumption_norms" (
	"id" serial PRIMARY KEY NOT NULL,
	"vehicle_size_class_id" integer NOT NULL,
	"liters_per_km" numeric(6, 4) NOT NULL,
	"effective_date" date DEFAULT now() NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "fuel_price_periods" (
	"id" serial PRIMARY KEY NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"source_note" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "vehicle_size_classes" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(20) NOT NULL,
	"name" varchar(50) NOT NULL,
	"is_container" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "vehicle_size_classes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "debit_note_overrides_snapshot_uniq" ON "debit_note_overrides" USING btree ("snapshot_id");--> statement-breakpoint
CREATE INDEX "freight_rate_snapshots_shipment_idx" ON "freight_rate_snapshots" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "freight_rate_snapshots_trip_idx" ON "freight_rate_snapshots" USING btree ("trip_id");--> statement-breakpoint
CREATE UNIQUE INDEX "freight_rate_terms_cust_route_date_uniq" ON "freight_rate_terms" USING btree ("customer_id","route_id","effective_date");--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_consumption_norms_class_date_uniq" ON "fuel_consumption_norms" USING btree ("vehicle_size_class_id","effective_date");--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_price_periods_from_uniq" ON "fuel_price_periods" USING btree ("effective_from");