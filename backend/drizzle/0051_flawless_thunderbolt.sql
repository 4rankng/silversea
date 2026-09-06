-- Lean-down: merge 1:1 trip_instructions into trips (manager contact +
-- guidance become three trips columns; no separate row lifecycle).
-- Prod rows: 0 (2026-09-06 read-only pre-flight) — the UPDATE ... FROM is a
-- no-op safety net for any dev DB that still holds rows.
ALTER TABLE "trips" ADD COLUMN "instruction_contact_name" varchar(100);--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "instruction_contact_phone" varchar(20);--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "instruction_notes" text;--> statement-breakpoint
UPDATE "trips" SET
  "instruction_contact_name" = ti."contact_name",
  "instruction_contact_phone" = ti."contact_phone",
  "instruction_notes" = ti."notes"
FROM "trip_instructions" ti WHERE ti."trip_id" = "trips"."id";--> statement-breakpoint
DROP TABLE "trip_instructions" CASCADE;
