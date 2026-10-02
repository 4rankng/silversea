-- Card 20260922_61 (ruling 8): the "ĐỒNG Ý CẬP NHẬT BÁO GIÁ" workflow —
-- when kế toán enters a fuel price period, every customer with an active
-- quotation gets a PENDING approval row; the engine caps that customer's
-- fuel period at the newest AGREED row (watermark) so a new price applies
-- only after approval. UNIQUE (period, customer) keeps generation idempotent.
CREATE TABLE IF NOT EXISTS "quotation_fuel_approvals" (
  "id" serial PRIMARY KEY,
  "fuel_price_period_id" integer NOT NULL REFERENCES "fuel_price_periods"("id"),
  "customer_id" integer NOT NULL,
  "quotation_id" integer NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'PENDING',
  "decided_by" integer,
  "decided_at" timestamp with time zone,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "quotation_fuel_approvals_period_customer_uniq"
  ON "quotation_fuel_approvals" ("fuel_price_period_id", "customer_id");