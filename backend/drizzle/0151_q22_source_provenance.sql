DROP INDEX "payment_allocations_receipt_target_uniq";--> statement-breakpoint
ALTER TABLE "billing_document_lines" ADD COLUMN "source_version" varchar(120);--> statement-breakpoint
ALTER TABLE "billing_document_lines" ADD COLUMN "source_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "issued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "authority_state" varchar(30) DEFAULT 'CURRENT' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "authority_warning_reason" text;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "authority_warning_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD COLUMN "billing_document_id" integer;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD COLUMN "source_trip_id" integer;--> statement-breakpoint
ALTER TABLE "trip_containers" ADD COLUMN "source_shipment_id" integer;--> statement-breakpoint
ALTER TABLE "trip_containers" ADD COLUMN "source_shipment_container_id" integer;--> statement-breakpoint
ALTER TABLE "trip_containers" ADD COLUMN "source_shipment_version" integer;--> statement-breakpoint
ALTER TABLE "trip_expenses" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_billing_document_id_billing_documents_id_fk" FOREIGN KEY ("billing_document_id") REFERENCES "public"."billing_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_source_trip_id_trips_id_fk" FOREIGN KEY ("source_trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_allocations_document_idx" ON "payment_allocations" USING btree ("billing_document_id","created_at");--> statement-breakpoint
CREATE INDEX "payment_allocations_source_trip_idx" ON "payment_allocations" USING btree ("source_trip_id","created_at");--> statement-breakpoint
CREATE INDEX "trip_containers_shipment_source_idx" ON "trip_containers" USING btree ("source_shipment_id","source_shipment_container_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_allocations_receipt_target_uniq" ON "payment_allocations" USING btree ("payment_receipt_id","target_type","target_id",coalesce("source_trip_id", 0)) WHERE "payment_allocations"."payment_receipt_id" is not null;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD CONSTRAINT "billing_documents_authority_state_check" CHECK ("billing_documents"."authority_state" in ('CURRENT', 'STALE', 'ADJUSTMENT_REQUIRED'));--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_billing_document_consistency_check" CHECK (("payment_allocations"."target_type" <> 'BILLING_DOCUMENT') or ("payment_allocations"."billing_document_id" is not null and "payment_allocations"."billing_document_id" = "payment_allocations"."target_id"));--> statement-breakpoint
ALTER TABLE "trip_containers" ADD CONSTRAINT "trip_containers_source_shipment_version_check" CHECK ("trip_containers"."source_shipment_version" is null or "trip_containers"."source_shipment_version" > 0);
