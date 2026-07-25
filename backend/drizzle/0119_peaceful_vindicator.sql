ALTER TABLE "shipment_documents" ADD COLUMN "expires_at" date;--> statement-breakpoint
ALTER TABLE "shipment_documents" ADD COLUMN "replaced_by" integer;