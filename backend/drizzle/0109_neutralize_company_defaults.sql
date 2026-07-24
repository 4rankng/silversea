-- White-label cleanup: the product must not carry another company's legal
-- identity. Migrations 0094 + 0099 seeded a specific company profile (NePO)
-- into app_settings under company.* for bootstrap, which made every fresh
-- deployment inherit NePO's name / address / tax code / bank account until an
-- admin manually overwrote each field on /config/company-info.
--
-- Remove only the rows that STILL hold those exact default values, so:
--   * a brand-new install (0094/0099 ran, admin never customized) → cleared,
--     the admin configures their own company from an empty slate;
--   * an install the admin already customized → customized rows survive.
-- company.logo_storage_key is never seeded, so it is not referenced here.
-- Mirrors the now-empty COMPANY_INFO_DEFAULTS (services/company-info.service.ts);
-- do NOT re-seed concrete company identity anywhere.
DELETE FROM "app_settings"
WHERE "setting_key" LIKE 'company.%'
  AND "setting_value" IN (
    'CÔNG TY TNHH NEPO',
    'Số 26/63/36 đường Vạn Mỹ, Phường Ngô Quyền, Thành phố Hải Phòng, Việt Nam',
    '0201588208',
    'Ông Phan Kim Phụng',
    'Giám Đốc',
    '190466529',
    'Ngân hàng TMCP Á Châu PGD Thái Phiên - Hải Phòng',
    '0225-8832393',
    'acc@nepocorp.com'
  );
