CREATE EXTENSION IF NOT EXISTS unaccent;
--> statement-breakpoint
ALTER TABLE "trucks" ADD COLUMN IF NOT EXISTS "next_inspection_date" date;
