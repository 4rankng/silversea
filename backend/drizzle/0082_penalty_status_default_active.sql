-- Migration hardening (KP-016 follow-up): replay-order regression guard.
-- 0080 set the penalty status default to 'PENDING'; 0081 reverted it to
-- 'ACTIVE'. A journal replay that re-runs 0080 without 0081 (recomputed-hash
-- runs, partial restores) can regress the default. This final normalization
-- unconditionally pins the default to 'ACTIVE' — SET DEFAULT is idempotent,
-- so replay order can never regress the schema.
ALTER TABLE "penalties" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
