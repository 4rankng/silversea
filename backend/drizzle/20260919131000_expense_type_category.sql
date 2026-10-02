-- Card 20260919_3: explicit settlement category on the expense-type catalog.
-- 1. Column (nullable-safe — no tenant data touched by the ALTER itself).
ALTER TABLE "forwarder_expense_types" ADD COLUMN "category" varchar(30);

-- 2. One-time backfill — the sanctioned place for name matching (this file
--    is history after landing; the runtime classification path stays
--    column-only). Ladder: code map → normalized name → NULL (Chưa phân
--    loại). Deterministic: every environment converges to the same state.
--
-- 2a. Code map (ruled 2026-09-19): seeded codes are stable identifiers.
--     WEIGHING deliberately absent — stays NULL per ruling (user decides on
--     the admin surface; catch-all keeps the money visible + conserved).
UPDATE "forwarder_expense_types"
SET "category" = CASE "code"
  WHEN 'CUSTOMS' THEN 'HQGS'
  WHEN 'INSPECTION' THEN 'HQGS'
  WHEN 'INSPECTION_SVC' THEN 'HQGS'
  WHEN 'INFRASTRUCTURE' THEN 'CSHT'
  WHEN 'LIFTING' THEN 'LIFT'
  WHEN 'LOWERING' THEN 'DROP'
  WHEN 'OTHER' THEN 'KHAC'
END
WHERE "category" IS NULL;

-- 2b. Normalized-name match for tenant-created types (case-insensitive,
--     diacritic both-forms; no hit → stays NULL → catch-all). Ordered so
--     more-specific patterns run first and later passes only see leftovers.
UPDATE "forwarder_expense_types"
SET "category" = 'HQGS'
WHERE "category" IS NULL AND (
  lower("name") LIKE '%to khai%' OR lower("name") LIKE '%tờ khai%'
  OR lower("name") LIKE '%hai quan%' OR lower("name") LIKE '%hải quan%'
  OR lower("name") LIKE '%kiem hoa%' OR lower("name") LIKE '%kiểm hóa%'
);

UPDATE "forwarder_expense_types"
SET "category" = 'CSHT'
WHERE "category" IS NULL AND (
  lower("name") LIKE '%ha tang%' OR lower("name") LIKE '%hạ tầng%'
  OR lower("name") LIKE '%ket cau%' OR lower("name") LIKE '%kết cấu%'
);

UPDATE "forwarder_expense_types"
SET "category" = 'LIFT'
WHERE "category" IS NULL AND (
  lower("name") LIKE '%nang%' OR lower("name") LIKE '%nâng%'
);

UPDATE "forwarder_expense_types"
SET "category" = 'DROP'
WHERE "category" IS NULL AND (
  lower("name") LIKE '%ha container%' OR lower("name") LIKE '%hạ container%'
  OR lower("name") LIKE '%lowering%'
);
