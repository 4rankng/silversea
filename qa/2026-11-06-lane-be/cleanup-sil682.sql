-- Cleanup for fixture-sil682.sql (LOCAL DEV DB ONLY).
DELETE FROM expense_accounting_sources WHERE id = 5000;
DELETE FROM driver_incidental_costs WHERE fee_name = 'Phí nâng container (QA fixture SIL-682)';
