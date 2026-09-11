-- 2026-09-11 user directive: remove the maker-checker flow entirely.
-- The customer never used governed approvals, so the governance_actions
-- machinery is dropped with this migration: the table and every soft
-- governance_action_id reference column + index. Governed write paths now
-- apply directly in-request (transient make->check->approve; no persisted
-- request rows), so nothing feeds the table anymore.
-- Pre-flight per BE runbook addendum v1.1: Gate A (sanity counts) and
-- Gate B (zero PENDING% rows) are checked at staging/prod cut time;
-- this local rehearsal is backup-first (pg_dump) per migrate rails.

DROP INDEX IF EXISTS financial_reporting_policy_versions_governance_action_uniq;
DROP INDEX IF EXISTS fuel_period_adjustments_action_source_uniq;
DROP INDEX IF EXISTS payment_refunds_governance_action_uniq;
DROP INDEX IF EXISTS salary_period_adjustments_action_uniq;
DROP INDEX IF EXISTS truck_financial_profile_versions_governance_action_uniq;
DROP INDEX IF EXISTS shipment_accounting_locks_release_governance_idx;

ALTER TABLE financial_reporting_policy_versions DROP COLUMN IF EXISTS governance_action_id;
ALTER TABLE fuel_period_adjustments DROP COLUMN IF EXISTS governance_action_id;
ALTER TABLE payment_refunds DROP COLUMN IF EXISTS governance_action_id;
ALTER TABLE salary_period_adjustments DROP COLUMN IF EXISTS governance_action_id;
ALTER TABLE shipment_accounting_locks DROP COLUMN IF EXISTS release_governance_action_id;
ALTER TABLE treasury_accounts DROP COLUMN IF EXISTS opening_governance_action_id;
ALTER TABLE treasury_movements DROP COLUMN IF EXISTS governance_action_id;
ALTER TABLE trip_financial_postings DROP COLUMN IF EXISTS governance_action_id;
ALTER TABLE truck_financial_profile_versions DROP COLUMN IF EXISTS governance_action_id;

DROP TABLE IF EXISTS governance_actions;
