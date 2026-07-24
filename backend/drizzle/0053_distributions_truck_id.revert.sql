-- Reverts 0053_distributions_truck_id.sql.
-- Drops the per-vehicle attribution column. Legacy entity-wide rows (NULL
-- truck_id) are unaffected; per-vehicle attribution is lost on revert.
ALTER TABLE distributions DROP COLUMN IF EXISTS truck_id;
