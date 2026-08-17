-- Preserve the historical UI meaning of "Hàng kết hợp" before the field is
-- made explicit on shipments. The update is idempotent and only upgrades rows
-- that were previously inferred from a positive trip-level combination charge.
UPDATE "shipments" AS shipment
SET "is_combined" = true
WHERE "is_combined" = false
  AND EXISTS (
    SELECT 1
    FROM "trips" AS trip
    WHERE trip."shipment_id" = shipment."id"
      AND COALESCE(trip."revenue_combine", 0) > 0
  );
