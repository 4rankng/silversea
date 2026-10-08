-- ==============================================================================
-- ONBOARD cusonboard.txt (29.7 - DATA PM.xlsx) -> PRODUCTION
-- Server: silversea.tingting.vip (silversea-postgres-1, db silversea)
-- Date: 2026-10-02. Companion rollback: onboard-cusonboard-2026-10-02-rollback.sql
-- Preceded by: update-factory-contacts-prod.sql (factory contacts, same day).
-- Scope notes:
--   * Staff phones: 17 of 20 doc entries; 3 are "Đang cập nhật" in the doc.
--   * Fleet: 35 doc combos -> trucks.preferred_route/note/tow_capacity_tons and
--     trailers.max_payload_tons. tow = group combo rating (33/22/29T),
--     payload = "đuôi" rating (25/15/25T). 4 prod trucks/trailers not in the
--     doc are left untouched.
--   * Pricing engine (Phần 6): freight_rate_terms (share/km/base fuel),
--     pricing_tables (8 priced classes × 3 routes; 15T is "Thỏa thuận" ->
--     withheld), fuel_consumption_norms (CONT20 0.32, CONT40 0.35 L/km on the
--     4 split classes the engine's family lookup resolves), fuel_price_periods
--     (25,760 from 2026-10-02). Surcharge stays INERT until the customer
--     confirms lag + threshold (engine §8 doctrine: UNSET mode never
--     auto-applies a fuel period).
--   * NOT done here (needs user word): Long Minh freight term 75d (prod) vs
--     15d (doc); truck reassignment 15E-018.83/15H-176.93 (displaces current
--     drivers); LCL size classes absent from vehicle_size_classes catalog.
-- ==============================================================================

BEGIN;

-- ── A. Staff phones (Phần 8.1) — fill only empty users.phone ────────────────
UPDATE users SET phone='0976496385', updated_at=NOW() WHERE username='phuongnt' AND deleted_at IS NULL AND (phone IS NULL OR phone='');
UPDATE users SET phone='0919612286', updated_at=NOW() WHERE username='namnv'    AND deleted_at IS NULL AND (phone IS NULL OR phone='');
UPDATE users SET phone='0931519559', updated_at=NOW() WHERE username='tiepvv'   AND deleted_at IS NULL AND (phone IS NULL OR phone='');
UPDATE users SET phone='0779264328', updated_at=NOW() WHERE username='hoapt'    AND deleted_at IS NULL AND (phone IS NULL OR phone='');
UPDATE users SET phone='0916933596', updated_at=NOW() WHERE username='liennt'   AND deleted_at IS NULL AND (phone IS NULL OR phone='');
UPDATE users SET phone='0936802576', updated_at=NOW() WHERE username='lydp'     AND deleted_at IS NULL AND (phone IS NULL OR phone='');
UPDATE users SET phone='0984885205', updated_at=NOW() WHERE username='bacdk'    AND deleted_at IS NULL AND (phone IS NULL OR phone='');
UPDATE users SET phone='0337234196', updated_at=NOW() WHERE username='anhdtv'   AND deleted_at IS NULL AND (phone IS NULL OR phone='');
UPDATE users SET phone='0375006893', updated_at=NOW() WHERE username='huyenntt' AND deleted_at IS NULL AND (phone IS NULL OR phone='');
UPDATE users SET phone='0325485114', updated_at=NOW() WHERE username='hoangnh'  AND deleted_at IS NULL AND (phone IS NULL OR phone='');
UPDATE users SET phone='0985666955', updated_at=NOW() WHERE username='hungld'   AND deleted_at IS NULL AND (phone IS NULL OR phone='');
UPDATE users SET phone='0869473180', updated_at=NOW() WHERE username='duongtt'  AND deleted_at IS NULL AND (phone IS NULL OR phone='');
UPDATE users SET phone='0386246234', updated_at=NOW() WHERE username='tuvn'     AND deleted_at IS NULL AND (phone IS NULL OR phone='');
UPDATE users SET phone='0362157612', updated_at=NOW() WHERE username='dungnv'   AND deleted_at IS NULL AND (phone IS NULL OR phone='');
UPDATE users SET phone='0376835610', updated_at=NOW() WHERE username='thanhdc'  AND deleted_at IS NULL AND (phone IS NULL OR phone='');
UPDATE users SET phone='0373553427', updated_at=NOW() WHERE username='hoangnm'  AND deleted_at IS NULL AND (phone IS NULL OR phone='');
UPDATE users SET phone='0369987353', updated_at=NOW() WHERE username='myvtt'    AND deleted_at IS NULL AND (phone IS NULL OR phone='');

-- ── B1. Driver Nguyễn Văn Dũng (doc #49, CCCD 027083019159): his row carried
--        the identically-named office staff number; doc phone is 0865 224 119 ─
UPDATE drivers SET phone='0865224119', updated_at=NOW()
WHERE code='NVDUNG' AND id_number='027083019159' AND deleted_at IS NULL;

-- ── B2. Missing drivers (doc #40 Bùi Ngọc Long, #53 Lê Quang Hảo).
--        Logins follow the seed convention: username = lower(code), Abc123.
--        Bank/salary/license stay NULL — the doc carries none for them. ───────
INSERT INTO users (username, full_name, password_hash, role, status)
VALUES ('bnlong', 'Bùi Ngọc Long', '$2a$10$8aesctprT2LfJ4bMChVy..WMPp3R/oQ9Kt5SvPne5DG5cIWE5tO42', 'DRIVER', 'ACTIVE')
ON CONFLICT (username) DO NOTHING;
INSERT INTO users (username, full_name, password_hash, role, status)
VALUES ('lqhao', 'Lê Quang Hảo', '$2a$10$8aesctprT2LfJ4bMChVy..WMPp3R/oQ9Kt5SvPne5DG5cIWE5tO42', 'DRIVER', 'ACTIVE')
ON CONFLICT (username) DO NOTHING;

INSERT INTO drivers (user_id, name, phone, code, id_number, status)
SELECT u.id, 'Bùi Ngọc Long', '0982514514', 'BNGLONG', '030085016494', 'ACTIVE'
FROM users u WHERE u.username='bnlong'
AND NOT EXISTS (SELECT 1 FROM drivers d WHERE d.deleted_at IS NULL AND upper(btrim(coalesce(d.code,'')))='BNGLONG');

INSERT INTO drivers (user_id, name, phone, code, id_number, status)
SELECT u.id, 'Lê Quang Hảo', '0329003586', 'LQHAO', '030081020160', 'ACTIVE'
FROM users u WHERE u.username='lqhao'
AND NOT EXISTS (SELECT 1 FROM drivers d WHERE d.deleted_at IS NULL AND upper(btrim(coalesce(d.code,'')))='LQHAO');

-- ── C. Route distance (Phần 4.2 + 6.2: Hải Phòng <--> Đồng Văn 130 km/chiều) ─
UPDATE routes SET distance_km=130, updated_at=NOW()
WHERE code='KCN Đồng Văn' AND deleted_at IS NULL AND distance_km <> 130;

-- ── D. Fleet enrichment (Phần 5, 35 combos) ─────────────────────────────────
-- Group I: xe nặng 2 cầu 3 giàn — 33T (đầu 15T/ đuôi 25T); trailer payload 25
UPDATE trucks SET tow_capacity_tons=33, preferred_route='Đi Combo - Đúng giờ', note='Nhóm I: 2 cầu 3 giàn, tải 33 tấn (đầu 15T/ đuôi 25T)', updated_at=NOW() WHERE license_plate='15E-016.26' AND deleted_at IS NULL;
UPDATE trucks SET tow_capacity_tons=33, preferred_route='Đi Combo - Đúng giờ', note='Nhóm I: 2 cầu 3 giàn, tải 33 tấn (đầu 15T/ đuôi 25T)', updated_at=NOW() WHERE license_plate='15H-052.82' AND deleted_at IS NULL;
UPDATE trucks SET tow_capacity_tons=33, note='Nhóm I: 2 cầu 3 giàn, tải 33 tấn (đầu 15T/ đuôi 25T); Lái xe mới', updated_at=NOW() WHERE license_plate='15H-055.79' AND deleted_at IS NULL;
UPDATE trucks SET tow_capacity_tons=33, preferred_route='Đi Combo', note='Nhóm I: 2 cầu 3 giàn, tải 33 tấn (đầu 15T/ đuôi 25T)', updated_at=NOW() WHERE license_plate='15H-207.01' AND deleted_at IS NULL;
UPDATE trucks SET tow_capacity_tons=33, preferred_route='Đi Combo - Đúng giờ', note='Nhóm I: 2 cầu 3 giàn, tải 33 tấn (đầu 15T/ đuôi 25T)', updated_at=NOW() WHERE license_plate='15H-076.36' AND deleted_at IS NULL;
UPDATE trucks SET tow_capacity_tons=33, preferred_route='Đi BNBG - Qua vé', note='Nhóm I: 2 cầu 3 giàn, tải 33 tấn (đầu 15T/ đuôi 25T)', updated_at=NOW() WHERE license_plate='15H-076.50' AND deleted_at IS NULL;
UPDATE trucks SET tow_capacity_tons=33, preferred_route='Đi Combo - Đúng giờ', note='Nhóm I: 2 cầu 3 giàn, tải 33 tấn (đầu 15T/ đuôi 25T)', updated_at=NOW() WHERE license_plate='15C-167.31' AND deleted_at IS NULL;
UPDATE trucks SET tow_capacity_tons=33, preferred_route='Đi BNBG - Qua vé', note='Nhóm I: 2 cầu 3 giàn, tải 33 tấn (đầu 15T/ đuôi 25T)', updated_at=NOW() WHERE license_plate='15H-205.57' AND deleted_at IS NULL;
UPDATE trucks SET tow_capacity_tons=33, preferred_route='Đi Combo - Đúng giờ', note='Nhóm I: 2 cầu 3 giàn, tải 33 tấn (đầu 15T/ đuôi 25T)', updated_at=NOW() WHERE license_plate='15H-209.51' AND deleted_at IS NULL;
UPDATE trucks SET tow_capacity_tons=33, preferred_route='Đi Combo - Đúng giờ', note='Nhóm I: 2 cầu 3 giàn, tải 33 tấn (đầu 15T/ đuôi 25T)', updated_at=NOW() WHERE license_plate='15H-209.49' AND deleted_at IS NULL;
-- Group II: xe nhỏ 1 cầu 2 giàn — 22T (đầu 10T/ đuôi 15T); trailer payload 15
UPDATE trucks SET tow_capacity_tons=22, preferred_route='Tuyến Hà Nam', note='Nhóm II: xe nhỏ 1 cầu 2 giàn, tải 22 tấn (đầu 10T/ đuôi 15T)', updated_at=NOW() WHERE license_plate='15H-087.19' AND deleted_at IS NULL;
UPDATE trucks SET tow_capacity_tons=22, preferred_route='Tuyến Hà Nam', note='Nhóm II: xe nhỏ 1 cầu 2 giàn, tải 22 tấn (đầu 10T/ đuôi 15T)', updated_at=NOW() WHERE license_plate='15E-019.80' AND deleted_at IS NULL;
UPDATE trucks SET tow_capacity_tons=22, preferred_route='Tuyến BNBG', note='Nhóm II: xe nhỏ 1 cầu 2 giàn, tải 22 tấn (đầu 10T/ đuôi 15T); Lái xe mới', updated_at=NOW() WHERE license_plate='15H-118.47' AND deleted_at IS NULL;
UPDATE trucks SET tow_capacity_tons=22, preferred_route='Quay đầu 1 vé', note='Nhóm II: xe nhỏ 1 cầu 2 giàn, tải 22 tấn (đầu 10T/ đuôi 15T); Chạy đúng giờ', updated_at=NOW() WHERE license_plate='15H-118.97' AND deleted_at IS NULL;
UPDATE trucks SET tow_capacity_tons=22, preferred_route='Tuyến BNBG - Đúng giờ', note='Nhóm II: xe nhỏ 1 cầu 2 giàn, tải 22 tấn (đầu 10T/ đuôi 15T); Hạn chế kẹp', updated_at=NOW() WHERE license_plate='15F-016.98' AND deleted_at IS NULL;
UPDATE trucks SET tow_capacity_tons=22, preferred_route='Tuyến BNBG', note='Nhóm II: xe nhỏ 1 cầu 2 giàn, tải 22 tấn (đầu 10T/ đuôi 15T); Chạy đúng giờ', updated_at=NOW() WHERE license_plate='15E-018.83' AND deleted_at IS NULL;
UPDATE trucks SET tow_capacity_tons=22, preferred_route='Tuyến BNBG - Đúng giờ', note='Nhóm II: xe nhỏ 1 cầu 2 giàn, tải 22 tấn (đầu 10T/ đuôi 15T); Lái xe mới', updated_at=NOW() WHERE license_plate='15C-184.62' AND deleted_at IS NULL;
UPDATE trucks SET tow_capacity_tons=22, preferred_route='Tuyến BNBG - Đúng giờ', note='Nhóm II: xe nhỏ 1 cầu 2 giàn, tải 22 tấn (đầu 10T/ đuôi 15T); Lái xe mới', updated_at=NOW() WHERE license_plate='15H-039.39' AND deleted_at IS NULL;
UPDATE trucks SET tow_capacity_tons=22, preferred_route='Tuyến BNBG', note='Nhóm II: xe nhỏ 1 cầu 2 giàn, tải 22 tấn (đầu 10T/ đuôi 15T); Chạy đúng giờ', updated_at=NOW() WHERE license_plate='15H-021.39' AND deleted_at IS NULL;
-- Group III: 1 cầu 3 giàn — 29T (đầu 10T/ đuôi 25T); trailer payload 25
UPDATE trucks SET tow_capacity_tons=29, preferred_route='Tuyến BNBG', note='Nhóm III: 1 cầu 3 giàn, tải 29 tấn (đầu 10T/ đuôi 25T)', updated_at=NOW() WHERE license_plate='15H-085.66' AND deleted_at IS NULL;
UPDATE trucks SET tow_capacity_tons=29, preferred_route='Tuyến BNBG', note='Nhóm III: 1 cầu 3 giàn, tải 29 tấn (đầu 10T/ đuôi 25T)', updated_at=NOW() WHERE license_plate='15H-116.24' AND deleted_at IS NULL;
UPDATE trucks SET tow_capacity_tons=29, preferred_route='Tuyến BNBG', note='Nhóm III: 1 cầu 3 giàn, tải 29 tấn (đầu 10T/ đuôi 25T); Chạy đúng giờ', updated_at=NOW() WHERE license_plate='15H-117.55' AND deleted_at IS NULL;
UPDATE trucks SET tow_capacity_tons=29, preferred_route='Tuyến BNBG', note='Nhóm III: 1 cầu 3 giàn, tải 29 tấn (đầu 10T/ đuôi 25T); Chạy đúng giờ', updated_at=NOW() WHERE license_plate='15H-119.64' AND deleted_at IS NULL;
UPDATE trucks SET tow_capacity_tons=29, preferred_route='Tuyến BNBG', note='Nhóm III: 1 cầu 3 giàn, tải 29 tấn (đầu 10T/ đuôi 25T)', updated_at=NOW() WHERE license_plate='15H-149.80' AND deleted_at IS NULL;
UPDATE trucks SET tow_capacity_tons=29, preferred_route='Tuyến BNBG', note='Nhóm III: 1 cầu 3 giàn, tải 29 tấn (đầu 10T/ đuôi 25T)', updated_at=NOW() WHERE license_plate='15H-119.87' AND deleted_at IS NULL;
UPDATE trucks SET tow_capacity_tons=29, preferred_route='Tuyến BNBG', note='Nhóm III: 1 cầu 3 giàn, tải 29 tấn (đầu 10T/ đuôi 25T); Chạy đúng giờ', updated_at=NOW() WHERE license_plate='15H-175.17' AND deleted_at IS NULL;
UPDATE trucks SET tow_capacity_tons=29, preferred_route='Quay đầu 1 vé', note='Nhóm III: 1 cầu 3 giàn, tải 29 tấn (đầu 10T/ đuôi 25T); Chạy đúng giờ', updated_at=NOW() WHERE license_plate='15H-174.81' AND deleted_at IS NULL;
UPDATE trucks SET tow_capacity_tons=29, preferred_route='Tuyến BNBG', note='Nhóm III: 1 cầu 3 giàn, tải 29 tấn (đầu 10T/ đuôi 25T); Lái mới, ưu tiên đơn', updated_at=NOW() WHERE license_plate='15H-150.77' AND deleted_at IS NULL;
UPDATE trucks SET tow_capacity_tons=29, preferred_route='Tuyến BNBG', note='Nhóm III: 1 cầu 3 giàn, tải 29 tấn (đầu 10T/ đuôi 25T); Chạy đúng giờ', updated_at=NOW() WHERE license_plate='15H-147.38' AND deleted_at IS NULL;
UPDATE trucks SET tow_capacity_tons=29, preferred_route='Tuyến BNBG', note='Nhóm III: 1 cầu 3 giàn, tải 29 tấn (đầu 10T/ đuôi 25T); Chạy đúng giờ', updated_at=NOW() WHERE license_plate='15H-154.98' AND deleted_at IS NULL;
UPDATE trucks SET tow_capacity_tons=29, preferred_route='Tuyến BNBG', note='Nhóm III: 1 cầu 3 giàn, tải 29 tấn (đầu 10T/ đuôi 25T); Chạy đúng giờ', updated_at=NOW() WHERE license_plate='15H-154.26' AND deleted_at IS NULL;
UPDATE trucks SET tow_capacity_tons=29, preferred_route='Tuyến BNBG', note='Nhóm III: 1 cầu 3 giàn, tải 29 tấn (đầu 10T/ đuôi 25T)', updated_at=NOW() WHERE license_plate='15H-154.38' AND deleted_at IS NULL;
UPDATE trucks SET tow_capacity_tons=29, preferred_route='Tuyến BNBG', note='Nhóm III: 1 cầu 3 giàn, tải 29 tấn (đầu 10T/ đuôi 25T); Ưu tiên chạy Combo', updated_at=NOW() WHERE license_plate='15H-176.93' AND deleted_at IS NULL;
UPDATE trucks SET tow_capacity_tons=29, preferred_route='Tuyến BNBG', note='Nhóm III: 1 cầu 3 giàn, tải 29 tấn (đầu 10T/ đuôi 25T); Chạy đúng giờ', updated_at=NOW() WHERE license_plate='15H-174.23' AND deleted_at IS NULL;
UPDATE trucks SET tow_capacity_tons=29, preferred_route='Đi Combo - Qua vé', note='Nhóm III: 1 cầu 3 giàn, tải 29 tấn (đầu 10T/ đuôi 25T); Chạy đúng giờ', updated_at=NOW() WHERE license_plate='15H-176.51' AND deleted_at IS NULL;

UPDATE trailers SET max_payload_tons=25, updated_at=NOW() WHERE license_plate IN ('15RM-007.55','15R-182.06','15R-184.18','15RM-034.16','15R-068.52','15R-089.78','15R-103.08','15R-096.89','15RM-077.01','15RM-077.00') AND deleted_at IS NULL;
UPDATE trailers SET max_payload_tons=15, updated_at=NOW() WHERE license_plate IN ('15RM-017.97','15RM-008.02','15RM-027.54','15RM-029.34','15RM-001.41','15RM-006.78','15RM-023.26','15RM-171.96','15RM-013.12') AND deleted_at IS NULL;
UPDATE trailers SET max_payload_tons=25, updated_at=NOW() WHERE license_plate IN ('15RM-018.38','15RM-026.14','15RM-029.44','15RM-029.71','15RM-053.76','15RM-026.28','15RM-066.61','15RM-066.67','15RM-054.53','15RM-053.05','15RM-055.47','15RM-053.12','15RM-054.29','15RM-066.65','15RM-066.60','15RM-066.62') AND deleted_at IS NULL;

-- ── E. ASKEY 4-hour transit rule (Phần 3.4/3.5) — append only if absent ─────
UPDATE operational_sites SET strict_rules = strict_rules || E'\n- QUY ĐỊNH THỜI GIAN VẬN CHUYỂN TỐI ĐA 4 GIỜ: xe đóng xong hàng phải chạy thẳng về cảng hạ, dừng đố nghỉ dọc đường không quá 30 phút; quá 4 giờ phải báo ngay để xử lý. Hạ hàng xong gửi ngay ảnh phơi hạ bãi và định vị GPS lên nhóm điều hành. ASKEY kiểm tra GPS và thời gian hạ rất khắt khe — vi phạm có thể bị từ chối thanh toán toàn bộ chi phí chuyến.', updated_at = NOW()
WHERE code IN ('ASKEY-1','ASKEY-2') AND deleted_at IS NULL AND strict_rules NOT LIKE '%4 GIỜ%';

-- ── F. Pricing engine (Phần 6, Long Minh = customer 1) ──────────────────────
-- F1. Contract terms per route (base fuel = 19270/1.08 = 17842.5926; mốc 26/02).
--     lag=0 + UNSET on purpose: surcharge stays pending until customer confirms.
INSERT INTO freight_rate_terms (customer_id, route_id, share_pct, billing_km_one_way, billing_km_multiplier, base_fuel_price, fuel_lag_days, fuel_lag_confirmed, surcharge_threshold_mode, effective_date, note)
SELECT 1, r.id, v.share_pct, v.km, 2, 17842.5926, 0, false, 'UNSET', DATE '2026-10-02',
       'Nạp từ hồ sơ onboard cusonboard.txt 02/10/2026; ngưỡng biến động + độ trễ giá dầu chờ khách chốt'
FROM (VALUES ('KCN Đồng Văn', 2.00, 130), ('KCN Quế Võ', 4.00, 100), ('KCN Vân Trung', 2.50, 120)) AS v(route_code, share_pct, km)
JOIN routes r ON r.code = v.route_code AND r.deleted_at IS NULL
WHERE NOT EXISTS (
  SELECT 1 FROM freight_rate_terms t
  WHERE t.customer_id=1 AND t.route_id=r.id AND t.effective_date=DATE '2026-10-02' AND t.deleted_at IS NULL);

-- F2. Base prices per class × route (15T "Thỏa thuận" withheld for manual pricing).
INSERT INTO pricing_tables (customer_id, route_id, price, rate_key, effective_date)
SELECT 1, r.id, v.price, v.class_code, DATE '2026-10-02'
FROM (VALUES
  ('KCN Đồng Văn', 'CONT20', 3900000), ('KCN Đồng Văn', 'CONT40', 4100000),
  ('KCN Đồng Văn', '1.25T', 1300000), ('KCN Đồng Văn', '2.5T', 1700000), ('KCN Đồng Văn', '3.5T', 1800000),
  ('KCN Đồng Văn', '5T', 2400000), ('KCN Đồng Văn', '8T', 2900000), ('KCN Đồng Văn', '10T', 3100000),
  ('KCN Quế Võ', 'CONT20', 3800000), ('KCN Quế Võ', 'CONT40', 4000000),
  ('KCN Quế Võ', '1.25T', 1200000), ('KCN Quế Võ', '2.5T', 1600000), ('KCN Quế Võ', '3.5T', 1700000),
  ('KCN Quế Võ', '5T', 2300000), ('KCN Quế Võ', '8T', 2800000), ('KCN Quế Võ', '10T', 3000000),
  ('KCN Vân Trung', 'CONT20', 3900000), ('KCN Vân Trung', 'CONT40', 4100000),
  ('KCN Vân Trung', '1.25T', 1300000), ('KCN Vân Trung', '2.5T', 1700000), ('KCN Vân Trung', '3.5T', 1800000),
  ('KCN Vân Trung', '5T', 2400000), ('KCN Vân Trung', '8T', 2900000), ('KCN Vân Trung', '10T', 3100000)
) AS v(route_code, class_code, price)
JOIN routes r ON r.code = v.route_code AND r.deleted_at IS NULL
WHERE NOT EXISTS (
  SELECT 1 FROM pricing_tables p
  WHERE p.customer_id=1 AND p.route_id=r.id AND p.rate_key=v.class_code
    AND p.effective_date=DATE '2026-10-02' AND p.deleted_at IS NULL);

-- F3. Revenue-side fuel norms on the 4 catalog classes (CONT20 0.32, CONT40 0.35 L/km;
--     identical across routes in the doc). Engine family lookup resolves these for
--     base-code callers; quotation liters display keys BASE_CODES and stays best-effort.
INSERT INTO fuel_consumption_norms (vehicle_size_class_id, liters_per_km, effective_date, note)
SELECT c.id, v.lpk, DATE '2026-10-02', 'cusonboard.txt Phần 6 — định mức dầu véo vé (revenue-side)'
FROM (VALUES ('CONT20.LIGHT', 0.3200), ('CONT20.HEAVY', 0.3200), ('CONT40.LIGHT', 0.3500), ('CONT40.HEAVY', 0.3500)) AS v(class_code, lpk)
JOIN vehicle_size_classes c ON c.code = v.class_code AND c.deleted_at IS NULL
WHERE NOT EXISTS (
  SELECT 1 FROM fuel_consumption_norms n
  WHERE n.vehicle_size_class_id=c.id AND n.effective_date=DATE '2026-10-02' AND n.deleted_at IS NULL);

-- F4. Current fuel price period (doc: 25,760 VND/l kỳ tính toán thực tế).
INSERT INTO fuel_price_periods (unit_price, effective_from, source_note)
SELECT 25760.00, DATE '2026-10-02', 'cusonboard.txt Phần 6 — giá dầu kỳ tính toán thực tế; mốc hợp đồng 17.842,59 (26/02) nhúng trong freight_rate_terms.base_fuel_price'
WHERE NOT EXISTS (SELECT 1 FROM fuel_price_periods p WHERE p.effective_from=DATE '2026-10-02' AND p.deleted_at IS NULL);

-- ── G. Debit note template issuer profile (header + Phần 9.4) ───────────────
UPDATE debit_note_templates SET
  issuer_name = 'CÔNG TY TNHH THƯƠNG MẠI VÀ DỊCH VỤ SILVER SEA',
  issuer_address = 'Số 65, Tổ 9 Khu 6, Phường Hồng An, Thành phố Hải Phòng',
  issuer_tax_code = '0201985011',
  issuer_representative = 'Nguyễn Thị Phương',
  terms_text = terms_text || E'\nThanh toán chuyển khoản: STK 0031000391518 - Ngân hàng TMCP Ngoại thương Việt Nam (Vietcombank) - CN Hải Phòng. Liên hệ: 0976 496 385 - silverseahp@gmail.com',
  updated_at = NOW()
WHERE id = 1 AND deleted_at IS NULL AND (issuer_name IS NULL OR issuer_name = '');

-- ── Verification ─────────────────────────────────────────────────────────────
SELECT count(*) AS staff_phones_filled FROM users WHERE username IN ('phuongnt','namnv','tiepvv','hoapt','liennt','lydp','bacdk','anhdtv','huyenntt','hoangnh','hungld','duongtt','tuvn','dungnv','thanhdc','hoangnm','myvtt') AND phone IS NOT NULL AND phone <> '';
SELECT code, phone FROM drivers WHERE code IN ('NVDUNG','BNGLONG','LQHAO') AND deleted_at IS NULL ORDER BY code;
SELECT code, distance_km FROM routes WHERE code='KCN Đồng Văn' AND deleted_at IS NULL;
SELECT count(*) AS trucks_enriched FROM trucks WHERE deleted_at IS NULL AND tow_capacity_tons IS NOT NULL;
SELECT count(*) AS trailers_with_payload FROM trailers WHERE deleted_at IS NULL AND max_payload_tons IS NOT NULL;
SELECT count(*) AS rate_terms FROM freight_rate_terms WHERE deleted_at IS NULL;
SELECT count(*) AS pricing_rows FROM pricing_tables WHERE deleted_at IS NULL;
SELECT count(*) AS fuel_norms FROM fuel_consumption_norms WHERE deleted_at IS NULL;
SELECT effective_from, unit_price FROM fuel_price_periods WHERE deleted_at IS NULL ORDER BY effective_from;
SELECT issuer_name, issuer_tax_code FROM debit_note_templates WHERE id=1;

COMMIT;
