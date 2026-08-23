ALTER TABLE "advance_requests" ADD COLUMN "requester_name_snapshot" text;
--> statement-breakpoint
-- Backfill: every existing advance keeps the requester's name as known today,
-- so completed approvals stay legible after later account removal.
UPDATE "advance_requests" ar
SET "requester_name_snapshot" = u."full_name"
FROM "users" u
WHERE u."id" = ar."requester_id" AND ar."requester_name_snapshot" IS NULL;
