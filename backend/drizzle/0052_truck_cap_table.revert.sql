-- Reverts 0052_truck_cap_table.sql.
-- Drops the per-vehicle cap table. Forward-only in production; this revert
-- exists to satisfy the paired-migration convention so a dev DB can be rolled
-- back cleanly. Per-truck ownership data in `truck_cap_table` is lost on revert.
DROP TABLE IF EXISTS truck_cap_table;
