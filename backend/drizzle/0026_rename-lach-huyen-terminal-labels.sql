-- Keep the existing port rows (and their shipment-container references) while
-- applying the concise terminal labels approved by operations. Matching the
-- terminal codes first also covers the original deployment seed; the legacy
-- names cover reference-data rows that were created without a code.
UPDATE "ports"
SET
  "name" = CASE
    WHEN upper(btrim("code")) = 'HICT'
      OR "name" IN ('Cảng Lạch Huyện (HICT)', 'Cảng Lạch Huyện - HICT')
      THEN 'TC - HICT'
    WHEN upper(btrim("code")) = 'HTIT'
      OR "name" = 'Cảng TIL - HTIT'
      THEN 'TIL - HTIT'
    WHEN upper(btrim("code")) = 'HHIT'
      OR "name" = 'Cảng Hateco'
      THEN 'Hateco - HHIT'
    ELSE "name"
  END,
  "updated_at" = now()
WHERE "deleted_at" IS NULL
  AND (
    upper(btrim("code")) IN ('HICT', 'HTIT', 'HHIT')
    OR "name" IN (
      'Cảng Lạch Huyện (HICT)',
      'Cảng Lạch Huyện - HICT',
      'Cảng TIL - HTIT',
      'Cảng Hateco'
    )
  )
  AND "name" IS DISTINCT FROM CASE
    WHEN upper(btrim("code")) = 'HICT'
      OR "name" IN ('Cảng Lạch Huyện (HICT)', 'Cảng Lạch Huyện - HICT')
      THEN 'TC - HICT'
    WHEN upper(btrim("code")) = 'HTIT'
      OR "name" = 'Cảng TIL - HTIT'
      THEN 'TIL - HTIT'
    WHEN upper(btrim("code")) = 'HHIT'
      OR "name" = 'Cảng Hateco'
      THEN 'Hateco - HHIT'
    ELSE "name"
  END;
