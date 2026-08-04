ALTER TABLE "shipments" ADD COLUMN "order_exchange_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "order_exchange_started_by" integer;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "order_exchange_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "order_exchange_completed_by" integer;