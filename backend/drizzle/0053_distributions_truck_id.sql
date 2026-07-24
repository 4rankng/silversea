-- F3 — Per-vehicle attribution for distribution records.
-- Adds a nullable `truck_id` FK to `distributions`. Legacy entity-wide rows
-- keep NULL; new per-vehicle distribution rows set it to the owning truck.
-- One distributeProfit(q, y) call now inserts one row per (truck × partner)
-- with truck_id set. The entity view (display) = group by partner_name, Σ amount.
ALTER TABLE distributions
  ADD COLUMN truck_id integer REFERENCES trucks(id);
