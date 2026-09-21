-- Card 20260921_19 — the container deposit refund tracker: KT completes
-- money and dates; the ĐÃ-hoan-cuoc tick posts the collection into the
-- COMPANY (ACB) fund through the standing treasury engine. BILL + names are
-- the display keys; codes/enums are data.
CREATE TABLE IF NOT EXISTS "deposit_refund_trackers" (
  "id" serial PRIMARY KEY,
  "shipment_id" integer,
  "bill_number" varchar(80) NOT NULL,
  "customer_name" varchar(255) NOT NULL,
  "carrier_name" varchar(255) NOT NULL,
  "deposit_amount" numeric(15, 0) NOT NULL,
  "cv_submitted_date" date,
  "expected_refund_date" date,
  "status" varchar(20) NOT NULL DEFAULT 'CHUA_HOAN_CUOC',
  "refund_posted_movement_id" integer,
  "refund_posted_at" timestamp with time zone,
  "refund_posted_by" integer,
  "note" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deposit_refund_trackers_status_idx" ON "deposit_refund_trackers" ("status", "expected_refund_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deposit_refund_trackers_shipment_idx" ON "deposit_refund_trackers" ("shipment_id");--> statement-breakpoint
