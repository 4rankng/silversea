-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block on PG < 12;
-- drizzle applies each migration file outside a multi-statement transaction,
-- so this is safe (same pattern as 0050_commission_txn_type.sql). IF NOT EXISTS
-- makes re-runs idempotent.
ALTER TYPE "public"."txn_type" ADD VALUE IF NOT EXISTS 'SERVICE_FEE';