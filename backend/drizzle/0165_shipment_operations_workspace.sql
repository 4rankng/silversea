CREATE TYPE "public"."shipment_cargo_mode" AS ENUM('FCL', 'LCL');--> statement-breakpoint
CREATE TYPE "public"."shipment_trade_direction" AS ENUM('IMPORT', 'EXPORT');--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "trade_direction" "shipment_trade_direction";--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "cargo_mode" "shipment_cargo_mode";--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "factory_name" varchar(255);--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "shipping_line_name" varchar(255);--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "customs_cutoff_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "closing_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "planned_return_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "cargo_weight_kg" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "cargo_volume_cbm" numeric(10, 3);--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "package_count" integer;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "package_type" varchar(100);--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "operational_notes" text;