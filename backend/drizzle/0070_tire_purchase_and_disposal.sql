-- N1 tires: replace warranty-until with purchase date, add trailer linkage +
-- disposal (thanh lý) metadata. status stays varchar(20) (DISPOSED already fits).
--
-- Idempotent (2026-06-25): this migration's effects were applied on prod outside
-- drizzle but its hash was never recorded in __drizzle_migrations, so drizzle
-- re-runs it. RENAME has no IF EXISTS clause and ADD COLUMN/CONSTRAINT lacked
-- IF NOT EXISTS, so a naive re-run errored on prod ("column warranty_until does
-- not exist"). Each statement is now guarded: re-run is a no-op where the effects
-- already exist, and it still applies correctly on a fresh DB.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tires' AND column_name = 'warranty_until'
  ) THEN
    ALTER TABLE "tires" RENAME COLUMN "warranty_until" TO "purchased_at";
  END IF;
END
$$;--> statement-breakpoint

ALTER TABLE "tires" ADD COLUMN IF NOT EXISTS "trailer_id" integer;--> statement-breakpoint
ALTER TABLE "tires" ADD COLUMN IF NOT EXISTS "disposal_date" date;--> statement-breakpoint
ALTER TABLE "tires" ADD COLUMN IF NOT EXISTS "disposal_reason" varchar(120);--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tires_trailer_id_trailers_id_fk') THEN
    ALTER TABLE "tires" ADD CONSTRAINT "tires_trailer_id_trailers_id_fk"
      FOREIGN KEY ("trailer_id") REFERENCES "trailers"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END
$$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "tires_trailer_id_idx" ON "tires" ("trailer_id");
