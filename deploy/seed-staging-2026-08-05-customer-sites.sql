-- ═══════════════════════════════════════════════════════════════════════════════
-- Staging customer-owned operational sites (Biển Bạc + XNK HN) — 2026-08-05
-- Source: backend/src/seed/seed-operational-sites.ts (commit 6d2c0bd)
--
-- Closes DEF-20260804-002 (factory dropdown empty / nhà máy dropdown trống).
-- Idempotent: unique on (customer_id, code) WHERE deleted_at IS NULL.
--
-- Apply:
--   ssh root@vantai.tingting.vip 'docker exec -i vantai-postgres-1 psql -U vantai -d vantai' \
--     < deploy/seed-staging-2026-08-05-customer-sites.sql
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- Seed Biển Bạc (taxCode 0101234567) — 2 sites: 1 factory + 1 warehouse
INSERT INTO operational_sites (
  customer_id, code, name, site_type, address, contact_name, contact_phone, is_active
)
SELECT c.id, x.code, x.name, x.site_type, x.address, x.contact_name, x.contact_phone, true
FROM customers c
CROSS JOIN (VALUES
  ('BB-KHO-LONG-BIEN'::varchar, 'Kho Biển Bạc - Long Biên'::varchar, 'FACTORY'::text,
   'KCN Đài Linh, Phường Long Biên, Quận Long Biên, Hà Nội'::text,
   'Phạm Thị Biển'::varchar, '02253555555'::varchar),
  ('BB-KHO-DA-NANG'::varchar, 'Kho Biển Bạc - Đà Nẵng'::varchar, 'WAREHOUSE'::text,
   'KCN Hòa Khánh, Quận Liên Chiểu, Đà Nẵng'::text,
   'Phạm Thị Biển'::varchar, '02253555555'::varchar)
) AS x(code, name, site_type, address, contact_name, contact_phone)
WHERE c.deleted_at IS NULL
  AND c.tax_code = '0101234567'
ON CONFLICT (customer_id, code) WHERE deleted_at IS NULL DO UPDATE
  SET name = EXCLUDED.name,
      site_type = EXCLUDED.site_type,
      address = EXCLUDED.address,
      contact_name = EXCLUDED.contact_name,
      contact_phone = EXCLUDED.contact_phone,
      is_active = true,
      updated_at = now();

-- Seed XNK Hà Nội (taxCode 0107654321) — 2 sites: 1 warehouse + 1 factory
INSERT INTO operational_sites (
  customer_id, code, name, site_type, address, contact_name, contact_phone, is_active
)
SELECT c.id, x.code, x.name, x.site_type, x.address, x.contact_name, x.contact_phone, true
FROM customers c
CROSS JOIN (VALUES
  ('XNK-ICD-HA-NOI'::varchar, 'ICD Hà Nội'::varchar, 'WAREHOUSE'::text,
   'ICD Hà Nội, Km 9+500 Đại lộ Thăng Long, Hà Nội'::text,
   'Trịnh Văn Hà'::varchar, '02438888888'::varchar),
  ('XNK-NHA-MAY-BAC-SON'::varchar, 'Nhà máy Bắc Sơn'::varchar, 'FACTORY'::text,
   'KCN Bắc Sơn, Xã Tân Dân, Sóc Sơn, Hà Nội'::text,
   'Trịnh Văn Hà'::varchar, '02438888888'::varchar)
) AS x(code, name, site_type, address, contact_name, contact_phone)
WHERE c.deleted_at IS NULL
  AND c.tax_code = '0107654321'
ON CONFLICT (customer_id, code) WHERE deleted_at IS NULL DO UPDATE
  SET name = EXCLUDED.name,
      site_type = EXCLUDED.site_type,
      address = EXCLUDED.address,
      contact_name = EXCLUDED.contact_name,
      contact_phone = EXCLUDED.contact_phone,
      is_active = true,
      updated_at = now();

-- Seed Long Minh (taxCode 2300540419) — 1 site (factory Võ Cường) from the
-- shared seed. The richer Long Minh fixture (8 sites) lives in
-- seed-staging-quytrinh-sites.sql — run that separately when the operational
-- flow needs the full set. Here we just ensure the smoke-test factory exists.
INSERT INTO operational_sites (
  customer_id, code, name, site_type, address, contact_name, contact_phone, is_active
)
SELECT c.id, x.code, x.name, x.site_type, x.address, x.contact_name, x.contact_phone, true
FROM customers c
CROSS JOIN (VALUES
  ('LM-NHA-MAY-VO-CUONG'::varchar, 'Nhà máy Long Minh - Võ Cường'::varchar, 'FACTORY'::text,
   'Khu 2, Phường Võ Cường, Tỉnh Bắc Ninh'::text,
   'Ms. Vân'::varchar, NULL::varchar)
) AS x(code, name, site_type, address, contact_name, contact_phone)
WHERE c.deleted_at IS NULL
  AND c.tax_code = '2300540419'
ON CONFLICT (customer_id, code) WHERE deleted_at IS NULL DO UPDATE
  SET name = EXCLUDED.name,
      site_type = EXCLUDED.site_type,
      address = EXCLUDED.address,
      contact_name = EXCLUDED.contact_name,
      contact_phone = EXCLUDED.contact_phone,
      is_active = true,
      updated_at = now();

COMMIT;

\echo '--- Operational sites after seed ---'
SELECT c.tax_code, c.name AS customer, s.code, s.name, s.site_type
FROM operational_sites s
JOIN customers c ON c.id = s.customer_id
WHERE s.deleted_at IS NULL
  AND c.tax_code IN ('0101234567', '0107654321', '2300540419')
ORDER BY c.tax_code, s.code;
