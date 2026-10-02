-- Card 20260922_78 (operator ruling Q10): fee rows are SOFT-deleted, never
-- removed — every delete captures a free-text reason + actor + timestamp.
-- Adds the governed-deletion trail to trip_expenses (the three converting
-- surfaces) and invoice_tracking (tracker rows mirror their fee rows).
-- Nullable columns, no backfill: rows deleted before this card are gone by
-- design and legacy rows read as live.
ALTER TABLE "trip_expenses" ADD COLUMN "deletion_reason" text;--> statement-breakpoint
ALTER TABLE "trip_expenses" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trip_expenses" ADD COLUMN "deleted_by" integer;--> statement-breakpoint
ALTER TABLE "invoice_tracking" ADD COLUMN "deletion_reason" text;--> statement-breakpoint
ALTER TABLE "invoice_tracking" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoice_tracking" ADD COLUMN "deleted_by" integer;