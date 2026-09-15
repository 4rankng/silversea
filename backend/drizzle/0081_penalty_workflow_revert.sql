-- Revert the penalty approval workflow (user decision 2026-09-14: the
-- approve/reject workflow is removed; creation is immediate-effect again).
-- The workflow shipped and was removed the same day — no production rows
-- ever carried PENDING.
ALTER TABLE "penalties" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
ALTER TABLE "penalties" DROP COLUMN IF EXISTS "created_by";
ALTER TABLE "penalties" DROP COLUMN IF EXISTS "approved_by";
ALTER TABLE "penalties" DROP COLUMN IF EXISTS "approved_at";
