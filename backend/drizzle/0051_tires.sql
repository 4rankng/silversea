-- N1 — Tire management module.
-- Adds the `tires` table tracking individual tires by serial across their
-- lifecycle (IN_STOCK → IN_USE on a truck → RETIRED). `serial` is the unique
-- identity; install/remove endpoints flip truck_id + status + dates.
-- Soft-deleted via deleted_at (the generic CRUD factory relies on it).

CREATE TYPE tire_position AS ENUM (
  'FRONT_LEFT', 'FRONT_RIGHT',
  'REAR_OUTER_LEFT', 'REAR_OUTER_RIGHT',
  'REAR_INNER_LEFT', 'REAR_INNER_RIGHT',
  'SPARE', 'OTHER'
);

CREATE TYPE tire_status AS ENUM ('IN_STOCK', 'IN_USE', 'RETIRED');

CREATE TABLE tires (
  id              serial PRIMARY KEY,
  serial          varchar(64) NOT NULL UNIQUE,
  truck_id        integer REFERENCES trucks(id),
  position        tire_position,
  size            varchar(32),
  installed_at    date,
  removed_at      date,
  supplier_id     integer REFERENCES suppliers(id),
  cost            numeric(15,0) DEFAULT 0,
  warranty_until  date,
  status          tire_status DEFAULT 'IN_STOCK',
  created_at      timestamp DEFAULT now() NOT NULL,
  updated_at      timestamp DEFAULT now() NOT NULL,
  deleted_at      timestamp
);

CREATE INDEX tires_truck_id_idx ON tires(truck_id);
