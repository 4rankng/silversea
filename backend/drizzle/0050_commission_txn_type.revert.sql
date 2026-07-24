-- Reverts 0050_commission_txn_type.sql.
-- Irreversible: Postgres cannot cleanly DROP an enum value once added.
-- 'COMMISSION' is benign if unused (no rows reference it). Documented-irreversible.
SELECT 'noop';
