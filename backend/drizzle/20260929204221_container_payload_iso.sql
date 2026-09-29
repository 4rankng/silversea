-- Card 20260928_172 — "TRỌNG TẢI CONTAINER" in the phơi-phiếu container-specs column.
--
-- The column today shows cargo_weight_kg, which is the weight of the GOODS, not
-- the container's rated capacity — the two are read as the same thing in the
-- phơi-phiếu screenshot the request came from, and they are not: a 40'HC holds
-- about 26,500 kg of payload whether it carries 4,000 or 24,000.
--
-- PM decision (2026-09-29): show BOTH, the rated payload next to the cargo
-- weight. No schema anywhere carried payload / max_gross / tare, so this adds
-- the one number the UI actually shows.
--
-- Seed values are the standard ISO category ratings, keyed by the canonical
-- container_type codes. A type we have no rating for is left NULL on purpose:
-- the UI then shows "—", which is honest, rather than a guessed number.
-- Non-canonical rows (QA leftovers like "40'HC rework") are NOT matched — a
-- box's real plate rating is not knowable from its name.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, and the seed only touches the eight
-- canonical codes.
ALTER TABLE container_types
  ADD COLUMN IF NOT EXISTS payload_kg integer;

COMMENT ON COLUMN container_types.payload_kg IS
  'Rated payload capacity in kg, by ISO container category. NULL = no rating known for this type; the UI shows "—" rather than guessing.';

UPDATE container_types SET payload_kg = 28200 WHERE code = '20DC';
UPDATE container_types SET payload_kg = 28200 WHERE code = '20HC';
UPDATE container_types SET payload_kg = 28200 WHERE code = '20OT';
UPDATE container_types SET payload_kg = 27700 WHERE code = '20RF';
UPDATE container_types SET payload_kg = 26500 WHERE code = '40DC';
UPDATE container_types SET payload_kg = 26500 WHERE code = '40HC';
UPDATE container_types SET payload_kg = 26500 WHERE code = '40RF';
UPDATE container_types SET payload_kg = 27900 WHERE code = '45HC';
