-- ═══════════════════════════════════════════════════════════════════════════════
-- Staging customer master-data seed (Silver Sea / Long Minh)
-- Target: vantai.tingting.vip staging DB (DB: vantai, user: vantai)
-- Source: docs/quytrinh/BIẾU MẪU BÁO CÁO/*.xlsx (customer delivery 2026-07-30)
--
-- Scope: ADDITIVE upsert of real customer master data. Does NOT wipe the
--   existing 97 demo trips or users. Idempotent — safe to re-run.
--
-- Adds:
--   1. Silver Sea company identity → app_settings (canonical company.* keys)
--   2. Long Minh partner + linked supplier + customer (real MST 2300540419,
--      payment terms chi hộ 25 / cước 15 days, Ms.Vân manager)
--   3. "MẪU DEBIT LONG MINH" debit-note template, assigned to the customer
--   4. Repoints the existing `khachhang` CUSTOMER-role user to Long Minh
--
-- Password for khachhang: 123456 (unchanged — keeps its current hash)
-- Note: operational_sites (the 8 factories/warehouses) are staged separately
--   in deploy/seed-staging-quytrinh-sites.sql because that table only exists
--   after migration 0170, which requires a newer backend image than what
--   staging currently runs. Apply that file after the image redeploy.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. SILVER SEA company identity → app_settings
--    (canonical keys from COMPANY_INFO_SETTING_KEYS; columns are
--     setting_key / setting_value in the deployed schema)
-- ═══════════════════════════════════════════════════════════════════════════════
INSERT INTO app_settings (setting_key, setting_value) VALUES
  ('company.name',            'CÔNG TY TNHH THƯƠNG MẠI VÀ DỊCH VỤ SILVER SEA'),
  ('company.address',         'Số 65, Tổ 9 Khu 6, Phường Hồng An, Thành phố Hải Phòng'),
  ('company.tax_code',        '0201985011'),
  ('company.phone',           '0976496385'),
  ('company.email',           'silverseahp@gmail.com'),
  ('company.bank_account',    '0031000391518'),
  ('company.bank_name',       'Vietcombank'),
  ('company.representative',  'Nguyễn Thị Phương')
ON CONFLICT (setting_key) DO UPDATE
  SET setting_value = EXCLUDED.setting_value,
      updated_at    = now();

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. LONG MINH partner — unique on normalized_tax_code (expression: upper btrim)
-- ═══════════════════════════════════════════════════════════════════════════════
INSERT INTO partners (normalized_tax_code, display_tax_code, currency)
VALUES ('2300540419', '2300540419', 'VND')
ON CONFLICT (normalized_tax_code) DO UPDATE
  SET display_tax_code = EXCLUDED.display_tax_code,
      currency         = EXCLUDED.currency,
      updated_at       = now();

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. LONG MINH supplier (linked) — no unique index besides PK; guard by name+partner
-- ═══════════════════════════════════════════════════════════════════════════════
INSERT INTO suppliers (name, contact_person, phone, tax_code, note, status, partner_id, primary_type)
SELECT 'CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH',
       'Ms.Vân',
       NULL,
       '2300540419',
       'Email: longminh.logistic@gmail.com; account1@longminhbn.com.vn',
       'ACTIVE',
       p.id,
       'SERVICE'
FROM partners p
WHERE p.normalized_tax_code = '2300540419'
  AND NOT EXISTS (
    SELECT 1 FROM suppliers s
    WHERE lower(btrim(s.name)) = lower(btrim('CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH'))
      AND s.partner_id = p.id
  );

-- If it already existed, refresh the link columns so the customer FK is consistent.
UPDATE suppliers SET
  contact_person = 'Ms.Vân',
  tax_code       = '2300540419',
  note           = 'Email: longminh.logistic@gmail.com; account1@longminhbn.com.vn',
  status         = 'ACTIVE',
  partner_id     = (SELECT id FROM partners WHERE normalized_tax_code = '2300540419'),
  primary_type   = COALESCE(primary_type, 'SERVICE'),
  updated_at     = now()
WHERE lower(btrim(name)) = lower(btrim('CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH'))
  AND tax_code = '2300540419';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. LONG MINH customer — expression unique indexes, so resolve manually
-- ═══════════════════════════════════════════════════════════════════════════════
INSERT INTO customers (
  name, tax_code, partner_id, contact_person, phone, contact_info,
  payment_term_days, payment_date_policy, status, is_carrier,
  debit_note_mode, linked_supplier_id
)
SELECT 'CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH',
       '2300540419',
       p.id,
       'Ms.Vân',
       NULL,
       'longminh.logistic@gmail.com; account1@longminhbn.com.vn',
       15,                       -- payment_term_days: cước term drives AR aging
       'NEXT_BUSINESS_DAY',
       'ACTIVE',
       false,
       'MONTHLY',
       s.id
FROM partners p
LEFT JOIN suppliers s
       ON lower(btrim(s.name)) = lower(btrim('CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH'))
      AND s.partner_id = p.id
WHERE p.normalized_tax_code = '2300540419'
  AND NOT EXISTS (
    SELECT 1 FROM customers c
    WHERE c.deleted_at IS NULL
      AND lower(btrim(c.name)) = lower(btrim('CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH'))
      AND COALESCE(NULLIF(lower(btrim(c.tax_code)), ''), '')
        = COALESCE(NULLIF(lower(btrim('2300540419')), ''), '')
  );

-- Refresh the existing Long Minh customer row with the authoritative master data.
UPDATE customers SET
  tax_code             = '2300540419',
  partner_id           = (SELECT id FROM partners WHERE normalized_tax_code = '2300540419'),
  contact_person       = 'Ms.Vân',
  contact_info         = 'longminh.logistic@gmail.com; account1@longminhbn.com.vn',
  payment_term_days    = 15,
  payment_date_policy  = 'NEXT_BUSINESS_DAY',
  status               = 'ACTIVE',
  is_carrier           = false,
  debit_note_mode      = 'MONTHLY',
  linked_supplier_id   = (
        SELECT id FROM suppliers
        WHERE lower(btrim(name)) = lower(btrim('CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH'))
          AND tax_code = '2300540419'
        LIMIT 1),
  updated_at           = now()
WHERE deleted_at IS NULL
  AND lower(btrim(name)) = lower(btrim('CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH'));

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. "MẪU DEBIT LONG MINH" debit-note template → assign to Long Minh customer
--    (columns match shared DebitNoteTemplateColumn; only PK unique, manual guard)
-- ═══════════════════════════════════════════════════════════════════════════════
INSERT INTO debit_note_templates (
  name, is_default, document_type, title_text, accent_color,
  show_container_column, show_unit_column, grouping_mode, amount_in_words,
  orientation, terms_text, signature_left_label, signature_right_label, columns
)
SELECT 'MẪU DEBIT LONG MINH',
       false,
       'DEBIT_NOTE',
       'BẢNG KÊ XÁC NHẬN VẬN CHUYỂN HOÀN THÀNH / MẪU DEBIT LONG MINH',
       '#1F4E79',
       true,
       true,
       'NONE',
       false,
       'landscape',
       'Vui lòng đối chiếu các khoản phí dịch vụ và phí chi hộ theo từng chuyến đủ điều kiện.',
       'Khách hàng',
       'Người lập',
       '[
         {"id":"stt","label":"STT","variable":"rowIndex","headerGroup":null,"width":6,"align":"center","format":"number","total":false},
         {"id":"nha_may","label":"TÊN NHÀ MÁY","variable":"factoryName","headerGroup":null,"width":18,"align":"left","format":"text","total":false},
         {"id":"xuat_nhap","label":"NHẬP/ XUẤT","variable":"tradeDirectionLabel","headerGroup":null,"width":10,"align":"center","format":"text","total":false},
         {"id":"so_bill","label":"SỐ BILL","variable":"billNumber","headerGroup":null,"width":14,"align":"center","format":"text","total":false},
         {"id":"so_to_khai","label":"SỐ TỜ KHAI","variable":"declarationNumber","headerGroup":null,"width":14,"align":"center","format":"text","total":false},
         {"id":"so_luong","label":"SỐ CÂN/ KIỆN/ CONT","variable":"quantityLabel","headerGroup":null,"width":18,"align":"left","format":"text","total":false},
         {"id":"loai_xe","label":"LOẠI XE","variable":"vehicleType","headerGroup":null,"width":12,"align":"center","format":"text","total":false},
         {"id":"bien_so","label":"BKS","variable":"truckPlate","headerGroup":null,"width":12,"align":"center","format":"text","total":false},
         {"id":"cbm","label":"CBM","variable":"cargoVolumeCbm","headerGroup":null,"width":10,"align":"right","format":"number","total":false},
         {"id":"ngay_giao","label":"NGÀY GIAO HÀNG","variable":"deliveryDate","headerGroup":null,"width":12,"align":"center","format":"date","total":false},
         {"id":"tuyen_duong","label":"TUYẾN ĐƯỜNG MỚI","variable":"routeName","headerGroup":null,"width":20,"align":"left","format":"text","total":false},
         {"id":"phi_giao_hang","label":"PHÍ GIAO HÀNG","variable":"deliveryFeeAmount","headerGroup":"PHÍ DỊCH VỤ","width":12,"align":"right","format":"currency","total":true},
         {"id":"cuoc_van_chuyen","label":"CƯỚC VẬN CHUYỂN","variable":"freightAmount","headerGroup":"PHÍ DỊCH VỤ","width":14,"align":"right","format":"currency","total":true},
         {"id":"lach_huyen","label":"LẠCH HUYỆN","variable":"portFeeAmount","headerGroup":"PHÍ DỊCH VỤ","width":12,"align":"right","format":"currency","total":true},
         {"id":"chi_phi_khac","label":"CHI PHÍ KHÁC","variable":"otherServiceFeeAmount","headerGroup":"PHÍ DỊCH VỤ","width":12,"align":"right","format":"currency","total":true},
         {"id":"phu_phi_xang_dau","label":"PHỤ PHÍ XĂNG DẦU","variable":"fuelSurchargeAmount","headerGroup":"PHÍ DỊCH VỤ","width":12,"align":"right","format":"currency","total":true},
         {"id":"ncc","label":"TÊN ĐƠN VỊ","variable":"recoverableSupplierName","headerGroup":"PHÍ CHI HỘ","width":18,"align":"left","format":"text","total":false},
         {"id":"loai_phi","label":"LOẠI PHÍ","variable":"recoverableFeeType","headerGroup":"PHÍ CHI HỘ","width":18,"align":"left","format":"text","total":false},
         {"id":"so_chung_tu","label":"SỐ HĐ","variable":"recoverableDocumentCode","headerGroup":"PHÍ CHI HỘ","width":14,"align":"center","format":"text","total":false},
         {"id":"so_tien","label":"SỐ TIỀN","variable":"recoverableAmount","headerGroup":"PHÍ CHI HỘ","width":12,"align":"right","format":"currency","total":true}
       ]'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM debit_note_templates dnt
  WHERE lower(btrim(dnt.name)) = lower(btrim('MẪU DEBIT LONG MINH'))
    AND dnt.document_type = 'DEBIT_NOTE'
    AND dnt.deleted_at IS NULL
);

-- Keep the template body current if it already existed, then assign it.
UPDATE debit_note_templates SET
  title_text              = 'BẢNG KÊ XÁC NHẬN VẬN CHUYỂN HOÀN THÀNH / MẪU DEBIT LONG MINH',
  accent_color            = '#1F4E79',
  show_container_column   = true,
  show_unit_column        = true,
  grouping_mode           = 'NONE',
  amount_in_words         = false,
  orientation             = 'landscape',
  terms_text              = 'Vui lòng đối chiếu các khoản phí dịch vụ và phí chi hộ theo từng chuyến đủ điều kiện.',
  signature_left_label    = 'Khách hàng',
  signature_right_label   = 'Người lập',
  updated_at              = now()
WHERE lower(btrim(name)) = lower(btrim('MẪU DEBIT LONG MINH'))
  AND document_type = 'DEBIT_NOTE'
  AND deleted_at IS NULL;

UPDATE customers SET
  debit_note_template_id = (
    SELECT id FROM debit_note_templates
    WHERE lower(btrim(name)) = lower(btrim('MẪU DEBIT LONG MINH'))
      AND document_type = 'DEBIT_NOTE' AND deleted_at IS NULL
    LIMIT 1),
  updated_at = now()
WHERE deleted_at IS NULL
  AND lower(btrim(name)) = lower(btrim('CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH'));

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. Repoint existing `khachhang` CUSTOMER user → Long Minh
--    (username is unique; keep its current password hash — still 123456)
-- ═══════════════════════════════════════════════════════════════════════════════
UPDATE users SET
  role            = 'CUSTOMER',
  customer_id     = (SELECT id FROM customers
                     WHERE deleted_at IS NULL
                       AND lower(btrim(name)) = lower(btrim('CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH'))
                     LIMIT 1),
  full_name       = COALESCE(NULLIF(full_name,''), 'Khách hàng Long Minh'),
  email           = COALESCE(NULLIF(email,''), 'khachhang@longminhbn.com.vn'),
  status          = 'ACTIVE',
  updated_at      = now()
WHERE username = 'khachhang';

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Verification (run after apply)
-- ═══════════════════════════════════════════════════════════════════════════════
\echo '--- Silver Sea company identity ---'
SELECT setting_key, left(setting_value,60) FROM app_settings WHERE setting_key LIKE 'company.%' ORDER BY setting_key;
\echo '--- Long Minh partner ---'
SELECT id, normalized_tax_code, display_tax_code FROM partners WHERE normalized_tax_code = '2300540419';
\echo '--- Long Minh supplier ---'
SELECT id, name, tax_code, partner_id, primary_type FROM suppliers WHERE tax_code = '2300540419';
\echo '--- Long Minh customer ---'
SELECT id, name, tax_code, partner_id, linked_supplier_id, debit_note_template_id, payment_term_days, debit_note_mode FROM customers WHERE tax_code = '2300540419';
\echo '--- khachhang user ---'
SELECT id, username, role, customer_id FROM users WHERE username = 'khachhang';
