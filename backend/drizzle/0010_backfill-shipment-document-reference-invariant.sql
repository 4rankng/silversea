-- Custom SQL migration file, put your code below! --
-- Normalize historical rows before the following check constraint makes the
-- import Bill / export Booking rule database-enforced. Direction determines
-- the retained reference; unclassified rows keep Bill when both were stored,
-- matching the legacy workspace's Bill-first fallback.
UPDATE shipments
SET
  bl_number = CASE
    WHEN trade_direction = 'EXPORT' THEN NULL
    ELSE NULLIF(btrim(bl_number), '')
  END,
  booking_ref = CASE
    WHEN trade_direction = 'IMPORT' THEN NULL
    WHEN trade_direction IS NULL AND NULLIF(btrim(bl_number), '') IS NOT NULL THEN NULL
    ELSE NULLIF(btrim(booking_ref), '')
  END,
  updated_at = NOW()
WHERE bl_number IS NOT NULL
  OR booking_ref IS NOT NULL;
