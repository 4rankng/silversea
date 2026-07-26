CREATE TYPE "public"."handoff_status" AS ENUM('UNSEEN', 'SEEN', 'ACCEPTED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "dispatch_handoffs" (
	"id" serial PRIMARY KEY NOT NULL,
	"shipment_id" integer NOT NULL,
	"handler_id" integer,
	"priority" varchar(20) DEFAULT 'NORMAL' NOT NULL,
	"vehicle_needed_by" timestamp,
	"operational_note" text,
	"status" "handoff_status" DEFAULT 'UNSEEN' NOT NULL,
	"handoff_version" integer NOT NULL,
	"created_by" integer,
	"dispatched_at" timestamp DEFAULT now() NOT NULL,
	"seen_at" timestamp,
	"resolved_at" timestamp,
	"reject_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dispatch_handoffs" ADD CONSTRAINT "dispatch_handoffs_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_handoffs" ADD CONSTRAINT "dispatch_handoffs_handler_id_users_id_fk" FOREIGN KEY ("handler_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_handoffs" ADD CONSTRAINT "dispatch_handoffs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dispatch_handoffs_shipment_idx" ON "dispatch_handoffs" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "dispatch_handoffs_handler_idx" ON "dispatch_handoffs" USING btree ("handler_id");--> statement-breakpoint
CREATE INDEX "dispatch_handoffs_status_idx" ON "dispatch_handoffs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "dispatch_handoffs_shipment_active_uniq" ON "dispatch_handoffs" USING btree ("shipment_id") WHERE "dispatch_handoffs"."status" IN ('UNSEEN', 'SEEN');