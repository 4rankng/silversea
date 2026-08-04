CREATE TABLE "carrier_fleet_vehicles" (
	"id" serial PRIMARY KEY NOT NULL,
	"carrier_id" integer NOT NULL,
	"license_plate" varchar(20) NOT NULL,
	"normalized_plate" varchar(20) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "shipment_accounting_locks" (
	"id" serial PRIMARY KEY NOT NULL,
	"shipment_id" integer NOT NULL,
	"billing_document_id" integer NOT NULL,
	"billing_document_version" integer NOT NULL,
	"billing_period_snapshot" jsonb NOT NULL,
	"shipment_version_at_lock" integer NOT NULL,
	"reason" text NOT NULL,
	"activated_by" integer NOT NULL,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shipments" ALTER COLUMN "status" SET DEFAULT 'PENDING_DATE';--> statement-breakpoint
ALTER TABLE "shipment_fulfillments" ADD COLUMN "planned_carrier_type" varchar(20);--> statement-breakpoint
ALTER TABLE "shipment_fulfillments" ADD COLUMN "planned_external_carrier_id" integer;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "external_carrier_vehicle_id" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "carrier_fleet_vehicles_carrier_plate_uniq_idx" ON "carrier_fleet_vehicles" USING btree ("carrier_id","normalized_plate") WHERE "carrier_fleet_vehicles"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "carrier_fleet_vehicles_carrier_active_idx" ON "carrier_fleet_vehicles" USING btree ("carrier_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_accounting_locks_shipment_uniq_idx" ON "shipment_accounting_locks" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "shipment_accounting_locks_document_idx" ON "shipment_accounting_locks" USING btree ("billing_document_id");--> statement-breakpoint
CREATE INDEX "shipment_fulfillments_planned_external_carrier_idx" ON "shipment_fulfillments" USING btree ("planned_external_carrier_id");--> statement-breakpoint
CREATE INDEX "trips_external_carrier_vehicle_idx" ON "trips" USING btree ("external_carrier_vehicle_id");