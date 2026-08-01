-- ═══════════════════════════════════════════════════════════════════════════════
-- Staging factory / warehouse operational sites (Long Minh) — DEFERRED
-- Source: docs/quytrinh/.../29.7 - DATA PM.xlsx → "NHÀ MÁY" sheet (8 sites)
--
-- ⚠️  This file requires migration 0170_melodic_magus.sql (CREATE TABLE
--     operational_sites) to have been applied. The staging server's currently
--     running backend image (built 2026-07-29) only bundles up to migration
--     0165, so operational_sites does not yet exist there.
--
-- Apply AFTER the image redeploy that brings the backend to >= 0170:
--   1. (once) refresh gh token scope: gh auth refresh -h github.com -s write:packages
--   2. (once) point /opt/vantai/deploy/docker-compose.prod.yml image refs
--      from franknguyenvd/* to ghcr.io/4rankng/*
--   3. make demo   # build/push/pull/migrate/restart/health
--   4. then run THIS file:
--      ssh root@vantai.tingting.vip 'docker exec -i vantai-postgres-1 psql -U vantai -d vantai' \
--        < deploy/seed-staging-quytrinh-sites.sql
--
-- Idempotent: unique on (customer_id, code) WHERE deleted_at IS NULL.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- Common: resolve the Long Minh customer id once into a join.
INSERT INTO operational_sites (
  customer_id, code, name, site_type, address, google_maps_url,
  contact_name, contact_phone, lift_fee_invoice_name,
  lift_fee_invoice_address, lift_fee_tax_code, strict_rules, is_active
)
SELECT c.id, x.code, x.name, x.site_type, x.address, x.google_maps_url,
       x.contact_name, x.contact_phone, x.lift_fee_invoice_name,
       x.lift_fee_invoice_address, x.lift_fee_tax_code, x.strict_rules, true
FROM customers c
CROSS JOIN (VALUES
  -- NEWEB warehouses (Hà Nam / Ninh Bình) — MST 0700837869 NEWEB VIỆT NAM
  ('NEWEB-KHO 1'::varchar, 'NEWEB - Kho 1'::varchar, 'WAREHOUSE'::text,
   'CÔNG TY TNHH NEWEB VIỆT NAM — Lô đất CN01, KCN Đồng Văn III, Phường Đồng Văn, Hà Nam'::text,
   'https://maps.app.goo.gl/ybazQGNV6aikJm4z8'::text,
   NULL::varchar, NULL::varchar,
   'CÔNG TY TNHH NEWEB VIỆT NAM'::varchar,
   'Lô đất CN01, Khu công nghiệp Đồng Văn III, Phường Đồng Văn, Tỉnh Ninh Bình'::text,
   '0700837869'::varchar,
   'Lái xe đăng ký bảo vệ vào đóng/trả cho Long Minh. Gọi người quản lý kho trước khi vào. Nghiêm cấm hút thuốc. Yêu cầu vỏ container đẹp, sàn chắc.'::text),
  ('NEWEB-KHO 2', 'NEWEB - Kho 2', 'WAREHOUSE',
   'CÔNG TY TNHH NEWEB VIỆT NAM — Lô đất CN12, KCN hỗ trợ Đồng Văn 3, Phường Tiên Sơn, Ninh Bình',
   'https://maps.app.goo.gl/36mrLqTitnj1i6Cu5',
   NULL, NULL,
   'CÔNG TY TNHH NEWEB VIỆT NAM',
   'Lô đất CN01, Khu công nghiệp Đồng Văn III, Phường Đồng Văn, Tỉnh Ninh Bình',
   '0700837869',
   'Lái xe đăng ký bảo vệ vào đóng/trả cho Long Minh. Nghiêm cấm hút thuốc. Yêu cầu vỏ container đẹp, sàn chắc.'),
  ('NEWEB-KHO 3', 'NEWEB - Kho 3', 'WAREHOUSE',
   'CÔNG TY TNHH NEWEB VIỆT NAM — KCN Đồng Văn I Mở Rộng, Phường Đồng Văn, Ninh Bình',
   'https://maps.app.goo.gl/eTrnQTm9enFiRiV19',
   NULL, NULL,
   'CÔNG TY TNHH NEWEB VIỆT NAM',
   'Lô đất CN01, Khu công nghiệp Đồng Văn III, Phường Đồng Văn, Tỉnh Ninh Bình',
   '0700837869',
   'Lái xe đăng ký bảo vệ vào đóng/trả cho Long Minh. Nghiêm cấm hút thuốc. Yêu cầu vỏ container đẹp, sàn chắc.'),
  -- ASKEY factories (Bắc Ninh) — MST 2301231325
  ('ASKEY-XUONG-2', 'ASKEY - Xưởng 2', 'FACTORY',
   'CÔNG TY TNHH CÔNG NGHỆ ASKEY VIỆT NAM — Lô C7-2, KCN Quế Võ, Phường Nam Sơn, Bắc Ninh (Xưởng 2)',
   'https://maps.app.goo.gl/JXwySTuxyGARCcE57',
   NULL, NULL,
   'CÔNG TY TNHH CÔNG NGHỆ ASKEY VIỆT NAM',
   'Lô C7-2, KCN Quế Võ, Phường Nam Sơn, Tỉnh Bắc Ninh',
   '2301231325',
   'Trả hàng xong chụp BBGH lên nhóm. Nghiêm cấm hút thuốc. Đóng xong phải về thẳng cảng hạ (trong 4h). Khó tính — không tuân thủ không thanh toán cước.'),
  ('ASKEY-XUONG-1', 'ASKEY - Xưởng 1', 'FACTORY',
   'CÔNG TY TNHH CÔNG NGHỆ ASKEY VIỆT NAM — Lô C7-2, KCN Quế Võ, Phường Nam Sơn, Bắc Ninh (Xưởng 1)',
   'https://maps.app.goo.gl/YcxGG719wmH7knjR9',
   NULL, NULL,
   'CÔNG TY TNHH CÔNG NGHỆ ASKEY VIỆT NAM',
   'Lô C7-2, KCN Quế Võ, Phường Nam Sơn, Tỉnh Bắc Ninh',
   '2301231325',
   'Trả hàng xong chụp BBGH lên nhóm. Nghiêm cấm hút thuốc. Đóng xong phải về thẳng cảng hạ (trong 4h). Khó tính — không tuân thủ không thanh toán cước.'),
  -- SUNRISE (Bắc Ninh) — MST 2400859689
  ('SUNRISE', 'SUNRISE Technology', 'FACTORY',
   'CÔNG TY TNHH SUNRISE TECHNOLOGY (VIỆT NAM) — Lô CN-09, KCN Vân Trung, Phường Nếnh, Bắc Ninh',
   'https://maps.app.goo.gl/Qh9GMWCAAu2TKXGcA',
   'Kho SUNRISE'::varchar, '0946445198'::varchar,
   'CÔNG TY TNHH SUNRISE TECHNOLOGY (VIỆT NAM)',
   'Một phần Lô CN-09, Khu công nghiệp Vân Trung, Phường Nếnh, Tỉnh Bắc Ninh',
   '2400859689',
   'Lái xe ăn mặc gọn gàng (quần áo dài). Nghiêm cấm hút thuốc. Hàng điện tử yêu cầu vỏ đẹp, sàn chắc, không mùi, không thủng rách.'),
  -- SJ Tech (Bắc Ninh) — MST 2400763747
  ('SJ-TECH', 'SJ Tech Việt Nam', 'FACTORY',
   'CÔNG TY TNHH MTV SJ TECH VIỆT NAM — Lô CN-16, KCN Vân Trung, Phường Nếnh, Bắc Ninh',
   'https://maps.app.goo.gl/tRDrmQTXEmMfyEbx9',
   'Kho SJ Tech'::varchar, '0974987576'::varchar,
   'CÔNG TY TNHH MỘT THÀNH VIÊN SJ TECH VIỆT NAM',
   'Lô số CN-16, khu công nghiệp Vân Trung, Phường Nếnh, Tỉnh Bắc Ninh',
   '2400763747',
   'Lái xe ăn mặc gọn gàng. Nghiêm cấm hút thuốc. Bắt buộc có biên bản ký xác nhận đóng/trả (in 2 bản, lái xe cầm ký nhận).'),
  -- S-CONNECT (Bắc Ninh) — lift-fee invoices to Long Minh
  ('SCONECT', 'S-CONNECT BG VINA', 'FACTORY',
   'CÔNG TY TNHH S-CONNECT BG VINA — Lô CN-17, KCN Vân Trung, Phường Nếnh, Bắc Ninh',
   'https://maps.app.goo.gl/7P66XdaioJAfnHb58',
   'Ms. Huyền'::varchar, '0358334025'::varchar,
   'CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH',
   'Khu 2, Phường Võ Cường, Tỉnh Bắc Ninh, Việt Nam',
   '2300540419',
   'Lái xe ăn mặc gọn gàng. Nghiêm cấm hút thuốc. Bắt buộc có biên bản ký xác nhận đóng/trả (in 2 bản, lái xe cầm ký nhận).')
) AS x(code, name, site_type, address, google_maps_url, contact_name, contact_phone,
       lift_fee_invoice_name, lift_fee_invoice_address, lift_fee_tax_code, strict_rules)
WHERE c.deleted_at IS NULL
  AND lower(btrim(c.name)) = lower(btrim('CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH'))
ON CONFLICT (customer_id, code) WHERE deleted_at IS NULL DO UPDATE
  SET name                    = EXCLUDED.name,
      site_type               = EXCLUDED.site_type,
      address                 = EXCLUDED.address,
      google_maps_url         = EXCLUDED.google_maps_url,
      contact_name            = EXCLUDED.contact_name,
      contact_phone           = EXCLUDED.contact_phone,
      lift_fee_invoice_name   = EXCLUDED.lift_fee_invoice_name,
      lift_fee_invoice_address= EXCLUDED.lift_fee_invoice_address,
      lift_fee_tax_code       = EXCLUDED.lift_fee_tax_code,
      strict_rules            = EXCLUDED.strict_rules,
      is_active               = true,
      updated_at              = now();

COMMIT;

\echo '--- Long Minh operational sites ---'
SELECT id, code, name, site_type, is_active FROM operational_sites
WHERE customer_id = (SELECT id FROM customers WHERE tax_code = '2300540419')
ORDER BY code;
