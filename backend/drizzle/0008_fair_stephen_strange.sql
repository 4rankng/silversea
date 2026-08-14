ALTER TABLE "shipment_containers" ADD COLUMN "cargo_volume_cbm" numeric(12, 3);--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "customer_notes" text;
