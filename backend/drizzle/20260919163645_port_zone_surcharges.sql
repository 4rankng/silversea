-- Zone-surcharge config is DATA, not schema (card _2 / ruling 2026-09-19):
-- one row per port + structural kind. Adding a port or zone = a data row,
-- never a migration. Labels ride the config row so column headers can change
-- without deploys.
CREATE TABLE IF NOT EXISTS port_zone_surcharges (
  id serial PRIMARY KEY,
  port_id integer NOT NULL REFERENCES ports(id) ON DELETE CASCADE,
  kind_slug varchar(64) NOT NULL,
  label varchar(128) NOT NULL,
  amount numeric(15, 0) NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  deleted_at timestamp with time zone
);
CREATE UNIQUE INDEX IF NOT EXISTS port_zone_surcharges_port_kind_uniq
  ON port_zone_surcharges (port_id, kind_slug) WHERE deleted_at IS NULL;
