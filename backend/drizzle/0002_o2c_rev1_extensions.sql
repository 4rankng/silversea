CREATE TYPE "public"."load_state" AS ENUM('LOADED', 'EMPTY');--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "chi_ho_due_days" integer;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "cuoc_due_days" integer;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "fuel_surcharge_share_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "fuel_config" ADD COLUMN "base_unit_price" numeric(10, 0);--> statement-breakpoint
ALTER TABLE "lift_pricing" ADD COLUMN "load_state" "load_state" DEFAULT 'LOADED' NOT NULL;--> statement-breakpoint
UPDATE "lift_pricing"
SET "load_state" = "cargo_state"::text::"load_state"
WHERE "cargo_state" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "fuel_surcharge_amount" numeric(15, 0) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "fuel_surcharge_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "fuel_surcharge_snapshot_dirty" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "ap_cost_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "ap_snapshot_dirty" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "ap_snapshot_changed_at" timestamp with time zone;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "lift_pricing"
    GROUP BY "port_id", "container_type_id", "direction", "load_state", "effective_date"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate lift-pricing matrix rows must be reconciled before applying the O2C rev1 unique constraint';
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "lift_pricing_port_type_state_dir_date_uniq" ON "lift_pricing" USING btree ("port_id","container_type_id","direction","load_state","effective_date");
