-- Shipment codes switch from id-derivation to an independent per-month
-- counter (user ruling 2026-09-19 4b). Old codes stay; no data migration.
CREATE TABLE IF NOT EXISTS shipment_code_counters (
  year_month varchar(10) PRIMARY KEY,
  counter integer NOT NULL
);
