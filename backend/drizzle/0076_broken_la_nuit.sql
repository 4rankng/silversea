ALTER TABLE "shipments" ALTER COLUMN "customer_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "shipment_containers" ADD COLUMN "raw_pickup_port_name" varchar(255);--> statement-breakpoint
ALTER TABLE "shipment_containers" ADD COLUMN "raw_dropoff_port_name" varchar(255);--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "is_ad_hoc" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "raw_customer_name" varchar(255);--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "raw_route_name" varchar(255);