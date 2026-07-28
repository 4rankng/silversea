ALTER TABLE "payment_allocations"
  ADD COLUMN IF NOT EXISTS "original_due_date_snapshot" date;
--> statement-breakpoint
ALTER TABLE "payment_allocations"
  ADD COLUMN IF NOT EXISTS "processing_due_date_snapshot" date;
--> statement-breakpoint
ALTER TABLE "payment_allocations"
  ADD COLUMN IF NOT EXISTS "issue_timestamp_snapshot" timestamp;
