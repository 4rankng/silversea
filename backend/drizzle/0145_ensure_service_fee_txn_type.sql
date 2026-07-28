-- Older staging databases may have recorded the historical enum migration
-- before SERVICE_FEE was present in their original txn_type definition.
-- Keep this additive and idempotent so every upgrade path converges.
ALTER TYPE "public"."txn_type" ADD VALUE IF NOT EXISTS 'SERVICE_FEE';
