ALTER TABLE "freight_rate_terms" ADD COLUMN "fuel_lag_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "freight_rate_terms" ADD COLUMN "surcharge_threshold_mode" varchar(10) DEFAULT 'UNSET' NOT NULL;--> statement-breakpoint
-- Backfill: rows that already carry a threshold value are historically
-- CONFIRMED terms — they must not read as 'UNSET'.
UPDATE "freight_rate_terms" SET "surcharge_threshold_mode" = 'PCT' WHERE "surcharge_threshold_pct" IS NOT NULL;--> statement-breakpoint
UPDATE "freight_rate_terms" SET "surcharge_threshold_mode" = 'ABS' WHERE "surcharge_threshold_abs" IS NOT NULL;
