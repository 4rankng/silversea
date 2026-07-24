CREATE TABLE "billing_document_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"source_type" varchar(20) NOT NULL,
	"source_id" integer,
	"line_type" varchar(20) NOT NULL,
	"description" text NOT NULL,
	"route_name" varchar(255),
	"container_numbers" text,
	"base_amount" numeric(15, 0) DEFAULT '0' NOT NULL,
	"amount_override" numeric(15, 0),
	"excluded" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" varchar(20) NOT NULL,
	"entity_type" varchar(20) NOT NULL,
	"entity_id" integer NOT NULL,
	"entity_name" varchar(255),
	"range_from" date NOT NULL,
	"range_to" date NOT NULL,
	"note" text,
	"total_incl_vat" numeric(15, 0) DEFAULT '0' NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "billing_document_lines" ADD CONSTRAINT "billing_document_lines_document_id_billing_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."billing_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD CONSTRAINT "billing_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_document_lines_doc_idx" ON "billing_document_lines" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "billing_documents_entity_idx" ON "billing_documents" USING btree ("entity_type","entity_id");