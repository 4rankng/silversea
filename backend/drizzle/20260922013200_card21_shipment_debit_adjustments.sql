-- Card 20260921_21 — KẾ HOẠCH ĐIỀU ĐỘNG TỔNG HỢP: per-lot rate-adjustment
-- requests (gửi yêu cầu điều chỉnh cước). While a PENDING request exists the
-- lot cannot be exported to debit — both issuance routes 409 naming the lot.
-- Per the card's 2026-09-21 user ruling "duyệt" is a confirmation column,
-- not an approval queue. At-most-one-live-PENDING-per-lot is enforced
-- transactionally in the create path — deliberately NOT a partial unique
-- index (drizzle-kit mangles partial-index predicates when applying; 09-19 _32).
CREATE TABLE IF NOT EXISTS "shipment_rate_adjustment_requests" (
  "id" serial PRIMARY KEY,
  "shipment_id" integer NOT NULL REFERENCES "shipments"("id"),
  "status" varchar(16) NOT NULL DEFAULT 'PENDING',
  "ghi_chu" text,
  "requested_by" integer NOT NULL REFERENCES "users"("id"),
  "requested_at" timestamp with time zone NOT NULL DEFAULT now(),
  "confirmed_by" integer REFERENCES "users"("id"),
  "confirmed_at" timestamp with time zone,
  "withdrawn_at" timestamp with time zone
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipment_rate_adjustment_requests_shipment_idx" ON "shipment_rate_adjustment_requests" ("shipment_id");
