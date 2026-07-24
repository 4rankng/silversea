ALTER TABLE "trips" ADD COLUMN "revenue_empty_return" numeric(15, 0) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "revenue_combine" numeric(15, 0) DEFAULT '0';