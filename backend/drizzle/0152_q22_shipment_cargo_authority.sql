ALTER TABLE "shipments" ADD COLUMN "cargo_type_id" integer;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "source_shipment_version" integer;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_cargo_type_id_cargo_types_id_fk" FOREIGN KEY ("cargo_type_id") REFERENCES "public"."cargo_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_source_shipment_version_check" CHECK ("trips"."source_shipment_version" is null or "trips"."source_shipment_version" > 0);
