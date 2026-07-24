-- Add code column to advance_settlements with PT-YYMM-XXXX format
-- Idempotent: skips if column already exists

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'advance_settlements' AND column_name = 'code') THEN
    ALTER TABLE "advance_settlements" ADD COLUMN "code" varchar(20);
  END IF;
END $$;

-- Backfill existing rows: derive PT-YYMM-XXXX from created_at and id
UPDATE "advance_settlements" s
SET "code" = r.new_code
FROM (
  SELECT id, CONCAT(
    'PT-',
    TO_CHAR(created_at, 'YYMM'),
    '-',
    LPAD(ROW_NUMBER() OVER (PARTITION BY TO_CHAR(created_at, 'YYMM') ORDER BY id)::text, 4, '0')
  ) AS new_code
  FROM "advance_settlements"
  WHERE "code" IS NULL
) r
WHERE s.id = r.id AND s."code" IS NULL;

-- Make NOT NULL only if not already
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'advance_settlements' AND column_name = 'code' AND is_nullable = 'YES') THEN
    ALTER TABLE "advance_settlements" ALTER COLUMN "code" SET NOT NULL;
  END IF;
END $$;

-- Add unique index only if not exists
CREATE UNIQUE INDEX IF NOT EXISTS "advance_settlements_code_unique_idx" ON "advance_settlements" ("code");
