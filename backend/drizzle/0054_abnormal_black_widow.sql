-- B1 (feedback202606 GAP 4): adds DRIVER_PAYOUT to the txn_type enum.
-- Used by recordDriverPayout() to post a debit reducing a driver's payable
-- balance (company pays out salary/cash to the driver).
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block; drizzle
-- applies each migration file outside a multi-statement transaction, so this is
-- safe. IF NOT EXISTS makes this idempotent — prod re-runs (e.g. when CI was
-- blocked and migrations are replayed) will no-op instead of erroring.
ALTER TYPE "public"."txn_type" ADD VALUE IF NOT EXISTS 'DRIVER_PAYOUT';
