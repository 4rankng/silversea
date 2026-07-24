ALTER TABLE "drivers" ADD COLUMN "social_insurance" numeric(15, 0) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "customer_commission" numeric(15, 0) DEFAULT '0';