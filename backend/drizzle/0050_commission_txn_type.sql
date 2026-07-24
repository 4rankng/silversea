-- V2 / Phase 2: adds COMMISSION to the txn_type enum.
-- Used by the manual commission-posting path (suppliers we owe a commission to).
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block; drizzle applies
-- each migration file outside a multi-statement transaction, so this is safe.
ALTER TYPE txn_type ADD VALUE IF NOT EXISTS 'COMMISSION';
