ALTER TABLE "shipment_fulfillments" ADD COLUMN "planned_revenue" numeric(15, 0);--> statement-breakpoint
ALTER TABLE "shipment_fulfillments" ADD COLUMN "planned_carrier_cost" numeric(15, 0);--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "is_combined" boolean DEFAULT false NOT NULL;