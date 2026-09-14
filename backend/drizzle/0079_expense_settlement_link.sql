-- Expense <-> NCC-payment linkage (QA-089): the expense row records which
-- supplier payment settled it, so paid-status is ledger-backed and a future
-- payment reversal can restore UNPAID only when THIS payment still covers
-- the row (re-flip guard). Additive-only.
ALTER TABLE "expenses" ADD COLUMN "settled_by_payment_id" integer;
