-- F3 — Per-vehicle profit ownership.
-- Adds `truck_cap_table`: a history-based per-truck cap table mirroring
-- `cap_table_history` semantics (one snapshot row per partner per
-- effective_date per truck). `percentage` is explicit (0–100, owner share of
-- THAT truck's profit). Each truck distributes its quarter profit across its
-- active owners; the entity distribution is the derived sum across trucks.
-- Percentage is NOT derived from a contribution amount here — owners are named
-- per truck with their % share directly.

CREATE TABLE truck_cap_table (
  id              serial PRIMARY KEY,
  truck_id        integer NOT NULL REFERENCES trucks(id),
  partner_name    varchar(255) NOT NULL,
  percentage      numeric(5,2) NOT NULL DEFAULT 0,
  effective_date  date NOT NULL,
  created_at      timestamp DEFAULT now() NOT NULL,
  updated_at      timestamp DEFAULT now() NOT NULL
);

CREATE INDEX truck_cap_table_truck_effective_idx
  ON truck_cap_table(truck_id, effective_date);
