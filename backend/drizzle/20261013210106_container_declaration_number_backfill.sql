-- Backfill for card 261013200312: existing lot-level declaration numbers
-- land on every container of their lot (dev-lead ruling: "existing lot-level
-- declaration numbers should land on each container of their lot").
-- Rule: each lot's FIRST non-empty declaration (id-asc, the same order every
-- reader uses) is copied onto ALL of that lot's containers. Lots holding more
-- than one declaration number are rare (seed/audit data); first-on-all is the
-- predictable, reversible choice — the per-cont values remain individually
-- editable afterwards. Idempotent: re-running rewrites the same values.
UPDATE "shipment_containers" AS sc
SET "declaration_number" = sd."declaration_number"
FROM (
  SELECT DISTINCT ON ("shipment_id") "shipment_id", "declaration_number"
  FROM "shipment_declarations"
  WHERE "declaration_number" IS NOT NULL AND btrim("declaration_number") <> ''
  ORDER BY "shipment_id", "id" ASC
) AS sd
WHERE sc."shipment_id" = sd."shipment_id";
