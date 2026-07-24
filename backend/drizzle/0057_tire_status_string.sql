-- Requirements06 only asks to track tire serials, replacement dates, days used,
-- supplier, and warranty. Convert the old tire status enum into a plain string
-- and collapse the unrequested RETIRED state back into spare stock.

UPDATE "tires"
SET "status" = 'IN_STOCK'
WHERE "status"::text = 'RETIRED';--> statement-breakpoint

ALTER TABLE "tires"
  ALTER COLUMN "status" SET DATA TYPE varchar(20)
  USING "status"::text;--> statement-breakpoint
-- ALTER COLUMN ... SET DATA TYPE retains the old default expression
-- ('IN_STOCK'::tire_status), which keeps the enum pinned. Reset the default
-- to a plain string first so the DROP TYPE below doesn't hit a dependency.
ALTER TABLE "tires"
  ALTER COLUMN "status" SET DEFAULT 'IN_STOCK';--> statement-breakpoint

DROP TYPE IF EXISTS "public"."tire_status";
