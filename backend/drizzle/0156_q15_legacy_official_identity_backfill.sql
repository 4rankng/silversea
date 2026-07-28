ALTER TABLE "billing_documents"
  ADD COLUMN IF NOT EXISTS "official_identity_snapshot" jsonb;

-- Older releases did not retain legal identity independently from mutable
-- master data. Freeze the best authority available at migration time, label it
-- explicitly, and never silently read live identity for these issued records.
LOCK TABLE "billing_documents", "app_settings", "customers", "suppliers"
  IN SHARE ROW EXCLUSIVE MODE;

WITH company AS (
  SELECT
    COALESCE(MAX("setting_value") FILTER (WHERE "setting_key" = 'company.name'), '') AS company_name,
    COALESCE(MAX("setting_value") FILTER (WHERE "setting_key" = 'company.address'), '') AS company_address,
    COALESCE(MAX("setting_value") FILTER (WHERE "setting_key" = 'company.tax_code'), '') AS company_tax_code,
    COALESCE(MAX("setting_value") FILTER (WHERE "setting_key" = 'company.representative'), '') AS company_representative,
    COALESCE(MAX("setting_value") FILTER (WHERE "setting_key" = 'company.representative_title'), '') AS company_representative_title,
    COALESCE(MAX("setting_value") FILTER (WHERE "setting_key" = 'company.bank_account'), '') AS company_bank_account,
    COALESCE(MAX("setting_value") FILTER (WHERE "setting_key" = 'company.bank_name'), '') AS company_bank_name,
    COALESCE(MAX("setting_value") FILTER (WHERE "setting_key" = 'company.phone'), '') AS company_phone,
    COALESCE(MAX("setting_value") FILTER (WHERE "setting_key" = 'company.email'), '') AS company_email,
    NULLIF(MAX("setting_value") FILTER (WHERE "setting_key" = 'company.logo_storage_key'), '') AS company_logo_storage_key
  FROM "app_settings"
),
legacy AS (
  SELECT
    bd."id",
    bd."entity_type",
    bd."entity_name",
    bd."debit_note_template_snapshot" AS template_snapshot,
    COALESCE(bd."issued_at", bd."updated_at", bd."created_at") AS captured_at,
    c."name" AS customer_name,
    c."contact_info" AS customer_address,
    c."tax_code" AS customer_tax_code,
    c."contact_person" AS customer_representative,
    c."phone" AS customer_phone,
    sp."name" AS supplier_name,
    sp."note" AS supplier_address,
    sp."tax_code" AS supplier_tax_code,
    sp."contact_person" AS supplier_representative,
    sp."phone" AS supplier_phone,
    company.*
  FROM "billing_documents" bd
  CROSS JOIN company
  LEFT JOIN "customers" c
    ON bd."entity_type" = 'CUSTOMER' AND c."id" = bd."entity_id"
  LEFT JOIN "suppliers" sp
    ON bd."entity_type" = 'VENDOR' AND sp."id" = bd."entity_id"
  WHERE bd."deleted_at" IS NULL
    AND bd."debit_note_status" IS NOT NULL
    AND bd."debit_note_status" <> 'DRAFT'
    AND bd."official_identity_snapshot" IS NULL
)
UPDATE "billing_documents" bd
SET "official_identity_snapshot" = jsonb_build_object(
  'issuer', jsonb_build_object(
    'name', COALESCE(NULLIF(legacy.template_snapshot ->> 'issuerName', ''), legacy.company_name),
    'address', COALESCE(NULLIF(legacy.template_snapshot ->> 'issuerAddress', ''), legacy.company_address),
    'taxCode', COALESCE(NULLIF(legacy.template_snapshot ->> 'issuerTaxCode', ''), legacy.company_tax_code),
    'representative', COALESCE(NULLIF(legacy.template_snapshot ->> 'issuerRepresentative', ''), legacy.company_representative),
    'representativeTitle', legacy.company_representative_title,
    'phone', legacy.company_phone,
    'bankAccount', legacy.company_bank_account,
    'bankName', legacy.company_bank_name,
    'email', legacy.company_email,
    'logoStorageKey', legacy.company_logo_storage_key
  ),
  'counterparty', jsonb_build_object(
    'entityType', legacy.entity_type,
    'name', CASE
      WHEN legacy.entity_type = 'CUSTOMER' THEN COALESCE(legacy.customer_name, legacy.entity_name, '')
      ELSE COALESCE(legacy.supplier_name, legacy.entity_name, '')
    END,
    'address', CASE
      WHEN legacy.entity_type = 'CUSTOMER' THEN COALESCE(legacy.customer_address, '')
      ELSE COALESCE(legacy.supplier_address, '')
    END,
    'taxCode', CASE
      WHEN legacy.entity_type = 'CUSTOMER' THEN COALESCE(legacy.customer_tax_code, '')
      ELSE COALESCE(legacy.supplier_tax_code, '')
    END,
    'representative', CASE
      WHEN legacy.entity_type = 'CUSTOMER' THEN COALESCE(legacy.customer_representative, '')
      ELSE COALESCE(legacy.supplier_representative, '')
    END,
    'representativeTitle', 'Giám Đốc',
    'phone', CASE
      WHEN legacy.entity_type = 'CUSTOMER' THEN COALESCE(legacy.customer_phone, '')
      ELSE COALESCE(legacy.supplier_phone, '')
    END,
    'contactInfo', CASE
      WHEN legacy.entity_type = 'CUSTOMER' THEN COALESCE(legacy.customer_address, '')
      ELSE COALESCE(legacy.supplier_address, '')
    END
  ),
  'signatures', jsonb_build_object(
    'leftLabel', COALESCE(NULLIF(legacy.template_snapshot ->> 'signatureLeftLabel', ''), 'Khách hàng'),
    'leftName', COALESCE(legacy.template_snapshot ->> 'signatureLeftName', ''),
    'rightLabel', COALESCE(NULLIF(legacy.template_snapshot ->> 'signatureRightLabel', ''), 'Người lập'),
    'rightName', COALESCE(
      NULLIF(legacy.template_snapshot ->> 'signatureRightName', ''),
      REGEXP_REPLACE(legacy.company_representative, '^(Ông|Bà)[[:space:]]+', '', 'i'),
      ''
    )
  ),
  'captureMetadata', jsonb_build_object(
    'mode', 'LEGACY_CURRENT_MASTER_BACKFILL',
    'capturedAt', to_jsonb(legacy.captured_at)
  )
)
FROM legacy
WHERE bd."id" = legacy."id";
