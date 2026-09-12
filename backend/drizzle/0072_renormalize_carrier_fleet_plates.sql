-- Carrier-fleet plate normalization reconciliation: the original seed writer
-- kept dashes in normalized_plate ("15H-15498") while the runtime
-- resolve-carrier lookup strips every non-alphanumeric ("15H15498"), so any
-- dashed/dotted plate row was unresolvable and the dispatch carrier autofill
-- silently returned null. Re-derive the key from license_plate with the
-- runtime rule. The (carrier_id, normalized_plate) unique index will abort
-- the migration if two plates of one carrier collapse into one key — that is
-- a genuine duplicate to fix by hand, not something to hide.
UPDATE "carrier_fleet_vehicles"
SET "normalized_plate" = upper(regexp_replace("license_plate", '[^A-Za-z0-9]', '', 'g'));
