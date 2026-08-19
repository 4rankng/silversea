ALTER TABLE "ports" ADD COLUMN "dispatch_zone" varchar(32);--> statement-breakpoint
ALTER TABLE "shipment_fulfillments" ADD COLUMN "dispatch_classification" text;