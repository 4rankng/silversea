-- Lean-down: drop three dead columns.
-- customers.freight_payment_term_days: backend never persisted it (no zod
-- path) — CustomersPage form edits were silently discarded; FE form + list
-- column + shared type removed with it. trips.storage_fee_revenue and
-- trips.driver_order_accepted_at: zero references anywhere (rg across
-- backend/frontend/shared/e2e), NULL in 100% of rows (prod pre-flight
-- 2026-09-06: 0 NOT NULL on both).

ALTER TABLE "customers" DROP COLUMN "freight_payment_term_days";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "storage_fee_revenue";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "driver_order_accepted_at";