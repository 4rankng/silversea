-- Reverts 0049_slim_terrax.sql (N5 vehicle alert date columns).
-- Drops the three user-keyed compliance/service date columns added for
-- inspection / insurance / oil-service alerts (A12 + B4).
ALTER TABLE "trucks" DROP COLUMN IF EXISTS "next_inspection_date";
ALTER TABLE "trucks" DROP COLUMN IF EXISTS "insurance_expiry_date";
ALTER TABLE "trucks" DROP COLUMN IF EXISTS "last_oil_service_date";
