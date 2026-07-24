CREATE TYPE "public"."tire_position" AS ENUM('FRONT_LEFT', 'FRONT_RIGHT', 'REAR_OUTER_LEFT', 'REAR_OUTER_RIGHT', 'REAR_INNER_LEFT', 'REAR_INNER_RIGHT', 'SPARE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."tire_status" AS ENUM('IN_STOCK', 'IN_USE', 'RETIRED');--> statement-breakpoint
ALTER TYPE "public"."txn_type" ADD VALUE IF NOT EXISTS 'COMMISSION';--> statement-breakpoint
CREATE TABLE "tires" (
	"id" serial PRIMARY KEY NOT NULL,
	"serial" varchar(64) NOT NULL,
	"truck_id" integer,
	"position" "tire_position",
	"size" varchar(32),
	"installed_at" date,
	"removed_at" date,
	"supplier_id" integer,
	"cost" numeric(15, 0) DEFAULT '0',
	"warranty_until" date,
	"status" "tire_status" DEFAULT 'IN_STOCK',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "tires_serial_unique" UNIQUE("serial")
);
--> statement-breakpoint
CREATE TABLE "truck_cap_table" (
	"id" serial PRIMARY KEY NOT NULL,
	"truck_id" integer NOT NULL,
	"partner_name" varchar(255) NOT NULL,
	"percentage" numeric(5, 2) DEFAULT '0' NOT NULL,
	"effective_date" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "distributions" ADD COLUMN "truck_id" integer;--> statement-breakpoint
ALTER TABLE "tires" ADD CONSTRAINT "tires_truck_id_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tires" ADD CONSTRAINT "tires_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "truck_cap_table" ADD CONSTRAINT "truck_cap_table_truck_id_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tires_truck_id_idx" ON "tires" USING btree ("truck_id");--> statement-breakpoint
CREATE INDEX "truck_cap_table_truck_effective_idx" ON "truck_cap_table" USING btree ("truck_id","effective_date");--> statement-breakpoint
ALTER TABLE "distributions" ADD CONSTRAINT "distributions_truck_id_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE no action ON UPDATE no action;
