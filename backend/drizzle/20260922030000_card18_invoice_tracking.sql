-- Card 20260921_18 — THEO DÕI HÓA ĐƠN KẾT HỢP: one tracking row per combined
-- invoice against a lot's container trip. The supplier payment (số tiền trả
-- NCC) is mirrored into trip_expenses (Chi phí khác / "Chi phí hóa đơn") and
-- kept in sync through expense_id, so debit-side views see it without any
-- tracker-specific reads.
CREATE TABLE IF NOT EXISTS "invoice_tracking" (
  "id" serial PRIMARY KEY,
  "shipment_id" integer NOT NULL REFERENCES "shipments"("id"),
  "trip_id" integer NOT NULL REFERENCES "trips"("id"),
  "expense_id" integer REFERENCES "trip_expenses"("id"),
  "invoice_number" varchar(50) NOT NULL,
  "invoice_amount" numeric(15, 0) NOT NULL,
  "supplier_payment" numeric(15, 0) NOT NULL,
  "tax_code" varchar(20),
  "supplier_name" varchar(200),
  "com_note" varchar(200),
  "invoice_sent_at" date,
  "note" text,
  "progress" varchar(20) NOT NULL DEFAULT 'CHUA_GUI',
  "expense_date" date NOT NULL DEFAULT CURRENT_DATE,
  "created_by" integer REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_tracking_shipment_id_idx" ON "invoice_tracking" ("shipment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_tracking_trip_id_idx" ON "invoice_tracking" ("trip_id");
