CREATE TYPE "public"."customer_status" AS ENUM('ACTIVE', 'LOCKED');--> statement-breakpoint
CREATE TYPE "public"."driver_status" AS ENUM('ACTIVE', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."fuel_mode" AS ENUM('AUTO', 'FLAT_RATE');--> statement-breakpoint
CREATE TYPE "public"."loading_type" AS ENUM('HANG', 'VO');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('ADMIN', 'MANAGER', 'ACCOUNTANT', 'DRIVER', 'FORWARDER');--> statement-breakpoint
CREATE TYPE "public"."trailer_status" AS ENUM('ACTIVE', 'MAINTENANCE', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."trailer_type" AS ENUM('20FT', '40FT');--> statement-breakpoint
CREATE TYPE "public"."trip_photo_type" AS ENUM('CONTAINER', 'SEAL', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."trip_status" AS ENUM('CREATED', 'IN_TRANSIT', 'COMPLETED', 'LOCKED', 'CANCELED');--> statement-breakpoint
CREATE TYPE "public"."truck_status" AS ENUM('ACTIVE', 'MAINTENANCE', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."txn_type" AS ENUM('TRIP_REVENUE', 'PAYMENT_RECEIVED', 'PENALTY', 'MANAGEMENT_FEE', 'ADJUSTMENT', 'DRIVER_SALARY', 'VENDOR_EXPENSE', 'VENDOR_PAYMENT', 'FORWARDER_ADVANCE', 'FORWARDER_SETTLEMENT', 'EXTERNAL_CARRIER_COST', 'FUEL_EXPENSE', 'UNLOCK_REVERSAL', 'COMMISSION', 'DRIVER_PAYOUT', 'SERVICE_FEE');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"user_id" integer,
	"message" text NOT NULL,
	"entity_type" varchar(50),
	"entity_id" integer,
	"payload" jsonb,
	"ip_address" varchar(45),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cap_table_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"partner_name" varchar(255) NOT NULL,
	"contribution_amount" numeric(15, 0) DEFAULT '0' NOT NULL,
	"percentage" numeric(5, 2) DEFAULT '0' NOT NULL,
	"effective_date" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cargo_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"requires_photos" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"tax_code" varchar(20),
	"contact_person" varchar(255),
	"phone" varchar(20),
	"contact_info" text,
	"credit_limit" numeric(15, 0),
	"status" "customer_status" DEFAULT 'ACTIVE',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "distributions" (
	"id" serial PRIMARY KEY NOT NULL,
	"quarter" integer NOT NULL,
	"year" integer NOT NULL,
	"partner_name" varchar(255) NOT NULL,
	"amount" numeric(15, 0) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"name" varchar(255) NOT NULL,
	"phone" varchar(20),
	"assigned_truck_id" integer,
	"base_salary" numeric(15, 0),
	"status" "driver_status" DEFAULT 'ACTIVE',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "fuel_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"loaded_norm" numeric(6, 2) NOT NULL,
	"empty_norm" numeric(6, 2) NOT NULL,
	"supplement" numeric(6, 2) DEFAULT '3',
	"unit_price" numeric(10, 0) NOT NULL,
	"warning_threshold" numeric(6, 2) DEFAULT '37',
	"critical_threshold" numeric(6, 2) DEFAULT '40',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"txn_type" "txn_type" NOT NULL,
	"txn_id" integer,
	"receipt_id" varchar(100),
	"entity_type" varchar(50) NOT NULL,
	"entity_id" integer NOT NULL,
	"credit" numeric(15, 0) DEFAULT '0',
	"debit" numeric(15, 0) DEFAULT '0',
	"balance" numeric(15, 0) NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "management_fees" (
	"id" serial PRIMARY KEY NOT NULL,
	"month" integer NOT NULL,
	"year" integer NOT NULL,
	"amount" numeric(15, 0) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "penalties" (
	"id" serial PRIMARY KEY NOT NULL,
	"driver_id" integer NOT NULL,
	"trip_id" integer,
	"reason_id" integer,
	"custom_reason" text,
	"amount" numeric(15, 0) NOT NULL,
	"date" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "penalty_reasons" (
	"id" serial PRIMARY KEY NOT NULL,
	"reason_text" text NOT NULL,
	"default_amount" numeric(15, 0) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "pricing_tables" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"route_id" integer NOT NULL,
	"price" numeric(15, 0) NOT NULL,
	"effective_date" date DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "road_allowances" (
	"id" serial PRIMARY KEY NOT NULL,
	"route_id" integer NOT NULL,
	"trailer_type" "trailer_type" NOT NULL,
	"base_amount" numeric(15, 0) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "road_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"toll_per_station" numeric(15, 0) NOT NULL,
	"return_cargo_bonus" numeric(15, 0) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routes" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"distance_km" integer,
	"is_mountain" boolean DEFAULT false,
	"fixed_fuel_allowance" numeric(10, 2),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "salary_periods" (
	"id" serial PRIMARY KEY NOT NULL,
	"month" integer,
	"year" integer,
	"start_date" date,
	"end_date" date,
	"label" varchar(100),
	"default_start_day" integer,
	"default_end_day" integer,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "trailers" (
	"id" serial PRIMARY KEY NOT NULL,
	"license_plate" varchar(20) NOT NULL,
	"type" "trailer_type" NOT NULL,
	"status" "trailer_status" DEFAULT 'ACTIVE',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "trailers_license_plate_unique" UNIQUE("license_plate")
);
--> statement-breakpoint
CREATE TABLE "trip_code_counters" (
	"year_month" varchar(10) PRIMARY KEY NOT NULL,
	"counter" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_legs" (
	"id" serial PRIMARY KEY NOT NULL,
	"trip_id" integer NOT NULL,
	"sequence" integer NOT NULL,
	"origin" text NOT NULL,
	"destination" text NOT NULL,
	"km" integer NOT NULL,
	"loading_type" "loading_type" NOT NULL,
	"calculated_liters" numeric(10, 2),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_photos" (
	"id" serial PRIMARY KEY NOT NULL,
	"trip_id" integer NOT NULL,
	"type" "trip_photo_type" NOT NULL,
	"storage_key" varchar(255) NOT NULL,
	"uploaded_by" integer NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" serial PRIMARY KEY NOT NULL,
	"trip_code" varchar(50),
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" integer,
	"customer_id" integer NOT NULL,
	"customer_reference" text,
	"truck_id" integer NOT NULL,
	"driver_id" integer NOT NULL,
	"route_id" integer NOT NULL,
	"trailer_id" integer NOT NULL,
	"cargo_type_id" integer NOT NULL,
	"status" "trip_status" DEFAULT 'CREATED',
	"departure_date" date NOT NULL,
	"fuel_mode" "fuel_mode" DEFAULT 'AUTO',
	"fuel_liters_override" numeric(10, 2),
	"fuel_supplement_liters" numeric(10, 2) DEFAULT '0',
	"fuel_supplement_reason" text,
	"tolls_discount" numeric(15, 0) DEFAULT '0',
	"tolls_addition" numeric(15, 0) DEFAULT '0',
	"tolls_stations" integer DEFAULT 0,
	"has_return_cargo" boolean DEFAULT false,
	"driver_salary" numeric(15, 0),
	"fuel_price_applied" numeric(10, 0),
	"road_allowance_base_applied" numeric(15, 0),
	"fuel_loaded_norm_applied" numeric(6, 2),
	"fuel_empty_norm_applied" numeric(6, 2),
	"fuel_fixed_allowance_applied" numeric(10, 2),
	"fuel_supplement_norm_applied" numeric(6, 2),
	"toll_per_station_applied" numeric(15, 0),
	"return_cargo_bonus_applied" numeric(15, 0),
	"fuel_liters" numeric(10, 2),
	"total_fuel_cost" numeric(15, 0),
	"total_road_allowance" numeric(15, 0),
	"total_cost" numeric(15, 0),
	"revenue" numeric(15, 0),
	"gross_profit" numeric(15, 0),
	"revenue_original" numeric(15, 0),
	"revenue_overridden_by" integer,
	"revenue_overridden_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "trips_trip_code_unique" UNIQUE("trip_code")
);
--> statement-breakpoint
CREATE TABLE "trucks" (
	"id" serial PRIMARY KEY NOT NULL,
	"license_plate" varchar(20) NOT NULL,
	"status" "truck_status" DEFAULT 'ACTIVE',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "trucks_license_plate_unique" UNIQUE("license_plate")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" varchar(100),
	"email" varchar(255),
	"phone" varchar(20),
	"full_name" varchar(255),
	"password_hash" text NOT NULL,
	"role" "role" DEFAULT 'DRIVER' NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_assigned_truck_id_trucks_id_fk" FOREIGN KEY ("assigned_truck_id") REFERENCES "public"."trucks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "penalties" ADD CONSTRAINT "penalties_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "penalties" ADD CONSTRAINT "penalties_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "penalties" ADD CONSTRAINT "penalties_reason_id_penalty_reasons_id_fk" FOREIGN KEY ("reason_id") REFERENCES "public"."penalty_reasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_tables" ADD CONSTRAINT "pricing_tables_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_tables" ADD CONSTRAINT "pricing_tables_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "road_allowances" ADD CONSTRAINT "road_allowances_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_legs" ADD CONSTRAINT "trip_legs_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_photos" ADD CONSTRAINT "trip_photos_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_photos" ADD CONSTRAINT "trip_photos_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_truck_id_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_trailer_id_trailers_id_fk" FOREIGN KEY ("trailer_id") REFERENCES "public"."trailers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_cargo_type_id_cargo_types_id_fk" FOREIGN KEY ("cargo_type_id") REFERENCES "public"."cargo_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "penalties_date_idx" ON "penalties" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "pricing_tables_customer_route_date_idx" ON "pricing_tables" USING btree ("customer_id","route_id","effective_date");--> statement-breakpoint
CREATE UNIQUE INDEX "road_allowances_route_type_idx" ON "road_allowances" USING btree ("route_id","trailer_type");
