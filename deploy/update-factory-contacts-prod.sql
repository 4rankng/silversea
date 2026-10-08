-- ==============================================================================
-- UPDATE FACTORY CONTACT PHONE & NAME ON PRODUCTION (operational_sites)
-- Generated from Master Data: 29.7 - DATA PM.xlsx / cusonboard.txt
-- Date: 2026-10-02
-- Target Server: silversea.tingting.vip
-- ==============================================================================

BEGIN;

-- 1. NEWEB-1 (KCN Đồng Văn III, Hà Nam)
UPDATE operational_sites
SET 
  contact_name = 'Mr Ngọc Anh',
  contact_phone = '0989130345',
  warehouse_contact_info = E'Mr Ngọc Anh: 0989130345\nMr Đức: 0398960072\nMr Hưng: 0968228796',
  updated_at = NOW()
WHERE code = 'NEWEB-1' AND deleted_at IS NULL;

-- 2. NEWEB-2 (KCN Đồng Văn III, Ninh Bình)
UPDATE operational_sites
SET 
  contact_name = 'A Quảng (阿广)',
  contact_phone = '0369860602',
  warehouse_contact_info = E'Ca ngày: 阿广 (A Quảng - Ưu tiên): 0369860602, 娴妙: 0968960376\nCa đêm: 阿兵: 0984259759',
  updated_at = NOW()
WHERE code = 'NEWEB-2' AND deleted_at IS NULL;

-- 3. NEWEB-3 (KCN Đồng Văn I, Ninh Bình)
UPDATE operational_sites
SET 
  contact_name = 'Anh Cương (阮文强)',
  contact_phone = '0971560672',
  warehouse_contact_info = E'Anh Cương (阮文强): 0971560672\nAnh Đoàn (郑成文团): 0367150368',
  updated_at = NOW()
WHERE code = 'NEWEB-3' AND deleted_at IS NULL;

-- 4. SUNRISE (KCN Vân Trung, Bắc Ninh)
UPDATE operational_sites
SET 
  contact_name = 'Kho Sunrise',
  contact_phone = '0946445198',
  warehouse_contact_info = 'SĐT liên hệ kho: 0946445198',
  updated_at = NOW()
WHERE code = 'SUNRISE' AND deleted_at IS NULL;

-- 5. SJ TECH (KCN Vân Trung, Bắc Ninh)
UPDATE operational_sites
SET 
  contact_name = 'Anh Chuyên',
  contact_phone = '0974987576',
  warehouse_contact_info = 'Kho SJ Tech - Anh Chuyên: 0974987576',
  updated_at = NOW()
WHERE code = 'SJ TECH' AND deleted_at IS NULL;

-- 6. SCONECT (KCN Vân Trung, Bắc Ninh)
UPDATE operational_sites
SET 
  contact_name = 'Ms. Huyền',
  contact_phone = '0358334025',
  warehouse_contact_info = E'Ms. Huyền: 0358334025\nMs. Ngân: 0968720506',
  updated_at = NOW()
WHERE code = 'SCONECT' AND deleted_at IS NULL;

-- Verification query
SELECT id, code, name, short_name, contact_name, contact_phone, warehouse_contact_info
FROM operational_sites
WHERE code IN ('NEWEB-1', 'NEWEB-2', 'NEWEB-3', 'ASKEY-1', 'ASKEY-2', 'SUNRISE', 'SJ TECH', 'SCONECT')
  AND deleted_at IS NULL
ORDER BY code;

COMMIT;
