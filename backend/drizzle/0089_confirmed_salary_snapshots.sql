-- Preserve the exact individual salary facts at confirmation. Historical rows
-- remain NULL: reconstructing them from today's rate would invent payroll history.
ALTER TABLE "salary_confirmations" ADD COLUMN "salary_snapshot" jsonb;
