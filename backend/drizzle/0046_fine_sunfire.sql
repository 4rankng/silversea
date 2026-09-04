ALTER TABLE "trailers" ALTER COLUMN "type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "code" varchar(50);--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "id_number" varchar(20);--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "license_number" varchar(20);--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "license_expiry_date" date;--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "bank_name" varchar(160);--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "bank_account" varchar(80);--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "salary_type" varchar(50);--> statement-breakpoint
ALTER TABLE "trailers" ADD COLUMN "max_payload_tons" numeric(6, 1);--> statement-breakpoint
ALTER TABLE "trailers" ADD COLUMN "max_axle_load_front_tons" numeric(6, 1);--> statement-breakpoint
ALTER TABLE "trailers" ADD COLUMN "max_axle_load_rear_tons" numeric(6, 1);--> statement-breakpoint
ALTER TABLE "trailers" ADD COLUMN "inspection_deadline" date;--> statement-breakpoint
ALTER TABLE "trailers" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "trucks" ADD COLUMN "vehicle_class" varchar(100);--> statement-breakpoint
ALTER TABLE "trucks" ADD COLUMN "brand" varchar(100);--> statement-breakpoint
ALTER TABLE "trucks" ADD COLUMN "tow_capacity_tons" numeric(6, 1);--> statement-breakpoint
ALTER TABLE "trucks" ADD COLUMN "fuel_l_per_100km_loaded" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "trucks" ADD COLUMN "fuel_l_per_100km_empty" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "trucks" ADD COLUMN "preferred_route" varchar(255);--> statement-breakpoint
ALTER TABLE "trucks" ADD COLUMN "note" text;--> statement-breakpoint
-- Pre-existing drift: the schema declared ports.classification (and
-- seed-ports writes it) but no migration ever created it. Guarded so
-- databases that already have it (demo) are unaffected.
ALTER TABLE "ports" ADD COLUMN IF NOT EXISTS "classification" varchar(20);
