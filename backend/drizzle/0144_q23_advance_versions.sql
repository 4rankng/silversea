ALTER TABLE "advance_requests" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "advance_settlements" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;