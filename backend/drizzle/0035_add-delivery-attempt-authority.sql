CREATE TABLE "customer_delivery_responses" (
	"id" serial PRIMARY KEY NOT NULL,
	"delivery_attempt_id" integer NOT NULL,
	"customer_visible_event_id" integer NOT NULL,
	"event_version" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"decision" text NOT NULL,
	"reason" text,
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"responded_by" integer NOT NULL,
	"idempotency_key" varchar(100) NOT NULL,
	"responded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_delivery_responses_dispute_reason_check" CHECK ("customer_delivery_responses"."decision" <> 'DISPUTED' or (length(trim("customer_delivery_responses"."reason")) between 1 and 1000))
);
--> statement-breakpoint
CREATE TABLE "delivery_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"shipment_id" integer NOT NULL,
	"fulfillment_id" integer NOT NULL,
	"trip_id" integer NOT NULL,
	"shipment_container_id" integer,
	"driver_progress_event_id" integer NOT NULL,
	"customer_visible_event_id" integer,
	"result" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "customer_delivery_responses_event_version_customer_uniq" ON "customer_delivery_responses" USING btree ("customer_visible_event_id","event_version","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_delivery_responses_idempotency_uniq" ON "customer_delivery_responses" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "customer_delivery_responses_attempt_idx" ON "customer_delivery_responses" USING btree ("delivery_attempt_id");--> statement-breakpoint
CREATE INDEX "customer_delivery_responses_customer_idx" ON "customer_delivery_responses" USING btree ("customer_id","responded_at");--> statement-breakpoint
CREATE INDEX "customer_delivery_responses_responded_by_idx" ON "customer_delivery_responses" USING btree ("responded_by");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_attempts_driver_progress_event_uniq" ON "delivery_attempts" USING btree ("driver_progress_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_attempts_customer_visible_event_uniq" ON "delivery_attempts" USING btree ("customer_visible_event_id") WHERE "delivery_attempts"."customer_visible_event_id" is not null;--> statement-breakpoint
CREATE INDEX "delivery_attempts_shipment_idx" ON "delivery_attempts" USING btree ("shipment_id","occurred_at");--> statement-breakpoint
CREATE INDEX "delivery_attempts_fulfillment_idx" ON "delivery_attempts" USING btree ("fulfillment_id","occurred_at");--> statement-breakpoint
CREATE INDEX "delivery_attempts_trip_idx" ON "delivery_attempts" USING btree ("trip_id","occurred_at");--> statement-breakpoint
CREATE INDEX "delivery_attempts_container_idx" ON "delivery_attempts" USING btree ("shipment_container_id");