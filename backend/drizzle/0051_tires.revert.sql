-- Reverts 0051_tires.sql.
-- Drops the tires table and its two enum types. Forward-only in production;
-- this revert exists to satisfy the paired-migration convention so a dev DB
-- can be rolled back cleanly. Data in `tires` is lost on revert.
DROP TABLE IF EXISTS tires;
DROP TYPE IF EXISTS tire_status;
DROP TYPE IF EXISTS tire_position;
