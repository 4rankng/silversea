-- Card _64 A2: facility-neutral routing key (port-names-are-data ruling).
-- DEDICATED_LACH_HUYEN → DEDICATED_DEPOT on persisted rows; idempotent on
-- re-run (second pass matches zero rows). Staging/prod application happens
-- inside the lead's cut runbook (backup-first), not unilaterally.
UPDATE quotation_fees SET routing = 'DEDICATED_DEPOT', updated_at = now()
WHERE routing = 'DEDICATED_LACH_HUYEN';

-- Row-level guard: zero survivors allowed past this migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM quotation_fees WHERE routing = 'DEDICATED_LACH_HUYEN') THEN
    RAISE EXCEPTION 'DEDICATED_LACH_HUYEN rows survive the rename migration';
  END IF;
END
$$;
