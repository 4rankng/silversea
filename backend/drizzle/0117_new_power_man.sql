CREATE TYPE "public"."ancillary_revenue_type" AS ENUM('LCL', 'CONSOLIDATION', 'SERVICE_DIFF', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."lift_direction" AS ENUM('LIFT_UP', 'LIFT_DOWN');--> statement-breakpoint
CREATE TYPE "public"."pricing_source" AS ENUM('TIER', 'TABLE', 'MANUAL');--> statement-breakpoint
CREATE TABLE "ancillary_revenue" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"shipment_id" integer,
	"trip_id" integer,
	"type" "ancillary_revenue_type" NOT NULL,
	"amount" numeric(15, 0) NOT NULL,
	"tax" numeric(15, 0) DEFAULT '0',
	"date" date DEFAULT now() NOT NULL,
	"document_ref" varchar(100),
	"note" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "fuel_norms" (
	"id" serial PRIMARY KEY NOT NULL,
	"route_id" integer,
	"truck_id" integer,
	"loaded_liters_per_100km" numeric(8, 2) NOT NULL,
	"empty_liters_per_100km" numeric(8, 2) NOT NULL,
	"supplement_liters" numeric(8, 2) DEFAULT '0',
	"flat_rate_liters" numeric(8, 2),
	"effective_date" date DEFAULT now() NOT NULL,
	"note" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "lift_pricing" (
	"id" serial PRIMARY KEY NOT NULL,
	"port_id" integer NOT NULL,
	"container_type_id" integer NOT NULL,
	"direction" "lift_direction" NOT NULL,
	"unit_price" numeric(15, 0) NOT NULL,
	"effective_date" date DEFAULT now() NOT NULL,
	"note" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "weight_pricing_tiers" (
	"id" serial PRIMARY KEY NOT NULL,
	"route_id" integer NOT NULL,
	"cargo_type_id" integer NOT NULL,
	"min_kg" numeric(12, 2) NOT NULL,
	"max_kg" numeric(12, 2) NOT NULL,
	"price_per_kg" numeric(12, 4) NOT NULL,
	"effective_date" date DEFAULT now() NOT NULL,
	"note" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "cargo_types" ADD COLUMN "is_bulk" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "pricing_source" "pricing_source";--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "pricing_formula" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "pricing_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "ancillary_revenue" ADD CONSTRAINT "ancillary_revenue_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ancillary_revenue" ADD CONSTRAINT "ancillary_revenue_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ancillary_revenue" ADD CONSTRAINT "ancillary_revenue_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ancillary_revenue" ADD CONSTRAINT "ancillary_revenue_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_norms" ADD CONSTRAINT "fuel_norms_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_norms" ADD CONSTRAINT "fuel_norms_truck_id_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_norms" ADD CONSTRAINT "fuel_norms_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lift_pricing" ADD CONSTRAINT "lift_pricing_port_id_ports_id_fk" FOREIGN KEY ("port_id") REFERENCES "public"."ports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lift_pricing" ADD CONSTRAINT "lift_pricing_container_type_id_container_types_id_fk" FOREIGN KEY ("container_type_id") REFERENCES "public"."container_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lift_pricing" ADD CONSTRAINT "lift_pricing_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weight_pricing_tiers" ADD CONSTRAINT "weight_pricing_tiers_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weight_pricing_tiers" ADD CONSTRAINT "weight_pricing_tiers_cargo_type_id_cargo_types_id_fk" FOREIGN KEY ("cargo_type_id") REFERENCES "public"."cargo_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weight_pricing_tiers" ADD CONSTRAINT "weight_pricing_tiers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ancillary_revenue_customer_date_idx" ON "ancillary_revenue" USING btree ("customer_id","date");--> statement-breakpoint
CREATE INDEX "ancillary_revenue_shipment_idx" ON "ancillary_revenue" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "ancillary_revenue_trip_idx" ON "ancillary_revenue" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "fuel_norms_route_truck_date_idx" ON "fuel_norms" USING btree ("route_id","truck_id","effective_date");--> statement-breakpoint
CREATE INDEX "lift_pricing_port_type_dir_date_idx" ON "lift_pricing" USING btree ("port_id","container_type_id","direction","effective_date");--> statement-breakpoint
CREATE INDEX "weight_pricing_tiers_route_cargo_date_idx" ON "weight_pricing_tiers" USING btree ("route_id","cargo_type_id","effective_date");