CREATE TYPE "public"."debit_note_status" AS ENUM('DRAFT', 'SENT', 'PENDING_CONFIRM', 'CONFIRMED', 'PARTIAL_PAID', 'PAID', 'REJECTED', 'CANCELED');--> statement-breakpoint
CREATE TYPE "public"."email_status" AS ENUM('PENDING', 'SENT', 'FAILED', 'OPENED');--> statement-breakpoint
CREATE TYPE "public"."milestone_type" AS ENUM('BOOKING_RECEIVED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'CUSTOMS_CLEARED', 'PICKED_UP', 'MANUAL');--> statement-breakpoint
CREATE TABLE "customer_email_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"shipment_id" integer,
	"billing_document_id" integer,
	"subject" varchar(255) NOT NULL,
	"recipient_email" varchar(255),
	"status" "email_status" DEFAULT 'PENDING',
	"error_message" text,
	"provider_message_id" varchar(255),
	"retry_count" integer DEFAULT 0 NOT NULL,
	"sent_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_milestones" (
	"id" serial PRIMARY KEY NOT NULL,
	"shipment_id" integer NOT NULL,
	"type" "milestone_type" NOT NULL,
	"note" text,
	"trip_id" integer,
	"changed_by" integer,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "debit_note_status" "debit_note_status" DEFAULT 'DRAFT';--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "customer_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "customer_confirmed_by" varchar(255);--> statement-breakpoint
ALTER TABLE "customer_email_logs" ADD CONSTRAINT "customer_email_logs_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_email_logs" ADD CONSTRAINT "customer_email_logs_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_email_logs" ADD CONSTRAINT "customer_email_logs_billing_document_id_billing_documents_id_fk" FOREIGN KEY ("billing_document_id") REFERENCES "public"."billing_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_email_logs" ADD CONSTRAINT "customer_email_logs_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_milestones" ADD CONSTRAINT "shipment_milestones_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_milestones" ADD CONSTRAINT "shipment_milestones_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_milestones" ADD CONSTRAINT "shipment_milestones_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_email_logs_customer_idx" ON "customer_email_logs" USING btree ("customer_id","status");--> statement-breakpoint
CREATE INDEX "customer_email_logs_status_idx" ON "customer_email_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "shipment_milestones_shipment_idx" ON "shipment_milestones" USING btree ("shipment_id","occurred_at");