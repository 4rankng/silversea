-- Tires use DISPOSED for business history. Deleted tire rows are user cleanup
-- actions and must not keep occupying unique serial numbers.
DELETE FROM "tires"
WHERE "deleted_at" IS NOT NULL;--> statement-breakpoint
