CREATE TABLE "debit_note_lots" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"shipment_id" integer NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	"released_by" integer,
	"release_reason" varchar(32)
);
--> statement-breakpoint
DROP INDEX "billing_documents_active_period_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "debit_note_lots_shipment_active_uniq" ON "debit_note_lots" USING btree ("shipment_id") WHERE "debit_note_lots"."released_at" is null;--> statement-breakpoint
CREATE INDEX "debit_note_lots_document_idx" ON "debit_note_lots" USING btree ("document_id");