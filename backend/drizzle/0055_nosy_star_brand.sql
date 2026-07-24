-- B2 (feedback202606 GAP 7) — truck_cap role.
-- Adds `role` to `truck_cap_table`: INVESTOR (capital partner, default) or
-- DRIVER (driver-contributor modeled as a per-truck profit participant by %).
-- TEXT + CHECK (not a pgEnum) avoids the enum-migration hassle and the name
-- collision with the existing user-role pgEnum. The split math is owner-agnostic;
-- `role` only labels the partner for UI display.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS for the column; the CHECK is wrapped in a
-- DO block so prod re-runs (e.g. when CI was blocked and migrations are
-- replayed) no-op instead of erroring on the duplicate constraint.

ALTER TABLE "truck_cap_table" ADD COLUMN IF NOT EXISTS "role" text DEFAULT 'INVESTOR' NOT NULL;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'truck_cap_role_check'
      AND conrelid = '"truck_cap_table"'::regclass
  ) THEN
    ALTER TABLE "truck_cap_table"
      ADD CONSTRAINT "truck_cap_role_check"
      CHECK ("truck_cap_table"."role" IN ('INVESTOR', 'DRIVER'));
  END IF;
END $$;
