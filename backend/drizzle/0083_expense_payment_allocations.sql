-- KP-079: explicit per-expense allocation records for supplier payments.
-- Each row tracks how much of a payment was allocated to a specific expense,
-- enabling partial payment support and proper reversal.

CREATE TABLE IF NOT EXISTS "expense_payment_allocations" (
  "id" serial PRIMARY KEY,
  "expense_id" integer NOT NULL,
  "payment_ledger_id" integer NOT NULL,
  "amount" numeric(15, 0) NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "exp_pay_alloc_expense_idx" ON "expense_payment_allocations" ("expense_id");
CREATE INDEX IF NOT EXISTS "exp_pay_alloc_payment_idx" ON "expense_payment_allocations" ("payment_ledger_id");
CREATE UNIQUE INDEX IF NOT EXISTS "exp_pay_alloc_expense_payment_uniq" ON "expense_payment_allocations" ("expense_id", "payment_ledger_id");
