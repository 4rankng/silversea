-- Custom SQL migration file, put your code below! --
ALTER TABLE "shipment_fulfillments"
  ALTER COLUMN "dispatch_classification" SET DEFAULT 'SINGLE';--> statement-breakpoint
ALTER TABLE "shipment_fulfillments"
  ALTER COLUMN "dispatch_classification" SET NOT NULL;
