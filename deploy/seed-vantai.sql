-- ═══════════════════════════════════════════════════════════════════════════════
-- Vantai Demo Seed — Realistic Vietnamese Trucking Company Data
-- Target: vantai.tingting.vip (demo server)
-- Password for ALL accounts: 123456
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- Wipe existing data (clean slate)
TRUNCATE TABLE
  trip_legs, trip_expenses, trip_containers, trip_expense_photos, trip_photos,
  trips, trip_code_counters,
  expenses, expense_photos,
  ledger, debt_offsets, distributions, management_fees, penalties, salary_periods,
  driver_work_days,
  advance_settlement_requests, settlement_expenses, advance_settlements, advance_requests,
  audit_logs, notifications,
  pricing_tables, road_allowances, road_config, route_distance_cache,
  routes, cargo_types,
  customers,
  drivers, trucks, trailers,
  suppliers, expense_categories, penalty_reasons,
  cap_table_history, fuel_config, fuel_price_history,
  container_types, ports, forwarder_expense_types,
  users
CASCADE;

-- Reset sequences
ALTER SEQUENCE IF EXISTS users_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS trucks_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS trailers_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS drivers_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS suppliers_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS customers_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS routes_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS cargo_types_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS trips_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS expense_categories_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS expenses_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS penalty_reasons_id_seq RESTART WITH 1;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. USERS  (password: 123456 → $2a$10$oHrsPSE9w4Vr6Dx5l6/VT.knjuK.R/4oTnh/ecL16iyR63hpzKMtq)
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO users (username, email, phone, password_hash, role, full_name) VALUES
  ('admin',    'admin@vantai.vn',    '0912345001', '$2a$10$oHrsPSE9w4Vr6Dx5l6/VT.knjuK.R/4oTnh/ecL16iyR63hpzKMtq', 'ADMIN',      'Trần Văn Admin'),
  ('giamdoc',  'giamdoc@vantai.vn',  '0912345002', '$2a$10$oHrsPSE9w4Vr6Dx5l6/VT.knjuK.R/4oTnh/ecL16iyR63hpzKMtq', 'MANAGER',    'Lê Văn Tỉnh'),
  ('ketoan',   'ketoan@vantai.vn',   '0912345003', '$2a$10$oHrsPSE9w4Vr6Dx5l6/VT.knjuK.R/4oTnh/ecL16iyR63hpzKMtq', 'ACCOUNTANT', 'Nguyễn Thị Mai'),
  ('laixe',    'laixe@vantai.vn',    '0912345004', '$2a$10$oHrsPSE9w4Vr6Dx5l6/VT.knjuK.R/4oTnh/ecL16iyR63hpzKMtq', 'DRIVER',     'Phạm Văn Hùng'),
  ('giaonhan', 'giaonhan@vantai.vn', '0912345005', '$2a$10$oHrsPSE9w4Vr6Dx5l6/VT.knjuK.R/4oTnh/ecL16iyR63hpzKMtq', 'FORWARDER',  'Nguyễn Văn Giao'),
  ('thu',      'thu@vantai.vn',      '0912345006', '$2a$10$oHrsPSE9w4Vr6Dx5l6/VT.knjuK.R/4oTnh/ecL16iyR63hpzKMtq', 'DRIVER',     'Nguyễn Văn Thụ'),
  ('nam',      'nam@vantai.vn',      '0912345007', '$2a$10$oHrsPSE9w4Vr6Dx5l6/VT.knjuK.R/4oTnh/ecL16iyR63hpzKMtq', 'DRIVER',     'Lê Hoài Nam'),
  ('tuan',     'tuan@vantai.vn',     '0912345008', '$2a$10$oHrsPSE9w4Vr6Dx5l6/VT.knjuK.R/4oTnh/ecL16iyR63hpzKMtq', 'DRIVER',     'Võ Minh Tuấn'),
  ('duc',      'duc@vantai.vn',      '0912345009', '$2a$10$oHrsPSE9w4Vr6Dx5l6/VT.knjuK.R/4oTnh/ecL16iyR63hpzKMtq', 'DRIVER',     'Phạm Đức Anh');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. TRUCKS & TRAILERS  (Hai Phong plates: 15H- prefix)
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO trucks (license_plate, status) VALUES
  ('15H-0123', 'ACTIVE'),
  ('15H-0234', 'ACTIVE'),
  ('15H-0345', 'ACTIVE'),
  ('15H-0456', 'ACTIVE'),
  ('15H-0567', 'ACTIVE'),
  ('15H-0678', 'ACTIVE'),
  ('15H-0789', 'MAINTENANCE');

INSERT INTO trailers (license_plate, type, status) VALUES
  ('70C-1122', '40FT', 'ACTIVE'),
  ('70C-2233', '40FT', 'ACTIVE'),
  ('70C-3344', '20FT', 'ACTIVE'),
  ('70C-4455', '40FT', 'ACTIVE'),
  ('70C-5566', '20FT', 'ACTIVE'),
  ('70C-6677', '40FT', 'ACTIVE');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. DRIVERS
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO drivers (user_id, name, phone, assigned_truck_id, base_salary, status) VALUES
  (4,  'Phạm Văn Hùng',   '0912345004', 1, '6000000',  'ACTIVE'),
  (6,  'Nguyễn Văn Thụ',  '0912345006', 2, '5500000',  'ACTIVE'),
  (7,  'Lê Hoài Nam',     '0912345007', 3, '5500000',  'ACTIVE'),
  (8,  'Võ Minh Tuấn',    '0912345008', 4, '5000000',  'ACTIVE'),
  (9,  'Phạm Đức Anh',    '0912345009', 5, '5000000',  'ACTIVE'),
  (NULL, 'Đỗ Văn Thành',  '0988111222', 6, '4800000',  'ACTIVE');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. SUPPLIERS
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO suppliers (name, contact_person, phone, tax_code, note, is_fuel_supplier) VALUES
  ('Petrolimex Hải Phòng',      'Nguyễn Văn Hải', '02253833888', '0100100746', 'Nhà cung cấp xăng dầu chính', true),
  ('PV Oil Hải Phòng',          'Trần Thị Thảo',  '02253929000', '0102716892', 'Nhà cung cấp xăng dầu dự phòng', true),
  ('Gara Thành Đông',           'Lê Văn Đông',     '0912345678',  '0304567890', 'Xưởng sửa chữa xe chính', false),
  ('Trạm Đăng kiểm 15-01S',    'Nguyễn Văn Đăng', '02253888888', '0304123456', 'Trung tâm đăng kiểm Hải Phòng', false),
  ('Bảo hiểm Bảo Việt HP',     'Phạm Minh Việt',  '1900558899',  '0100111307', 'Bảo hiểm xe', false),
  ('Cửa hàng phụ tùng Hoàng Yến', 'Vũ Hoàng',     '0967888999',  '0304987654', 'Phụ tùng xe đầu kéo', false),
  ('Trạm rửa xe sạch HP',      'Đặng Văn Sạch',   '0977666555',  '0304555444', 'Rửa xe container', false);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. CUSTOMERS  (real Vietnamese logistics/shipping companies)
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO customers (name, tax_code, contact_person, phone, status, is_carrier, debit_note_mode) VALUES
  ('Công ty TNHH Gemadept',              '0100807570', 'Nguyễn Tuấn Anh',   '02838228888', 'ACTIVE', true,  'MONTHLY'),
  ('Tổng Công ty Tân Cảng Sài Gòn',      '0300154567', 'Trần Minh Đức',     '02838881666', 'ACTIVE', false, 'MONTHLY'),
  ('Công ty CP Vận tải Hải An',          '0100811334', 'Phạm Quốc Hải',     '02253878888', 'ACTIVE', true,  'MONTHLY'),
  ('Công ty CP Logistico VN',            '0101756228', 'Lê Thanh Bình',     '02437988888', 'ACTIVE', false, 'PER_TRIP'),
  ('Công ty TNHH Vận tải Biển Đông',     '0300889234', 'Hoàng Văn Đông',    '02838556677', 'ACTIVE', false, 'PER_TRIP'),
  ('Công ty CP XNK Thương mại Thái Bình','0200387654', 'Đặng Thái Bình',    '02293888888', 'ACTIVE', false, 'MONTHLY'),
  ('Giao nhận Nhat Minh',                '0101567890', 'Nguyễn Nhật Minh',  '0912333444',  'ACTIVE', false, 'PER_TRIP'),
  ('Công ty CP Vận tải Container HP',    '0200498765', 'Vũ Đình Cường',     '02253789999', 'ACTIVE', true,  'MONTHLY'),
  ('Forwarder Hoàng Kim',                '0102345678', 'Kim Thị Lan',       '0988777666',  'ACTIVE', false, 'PER_TRIP'),
  ('Công ty CP Vinalink',                '0100865432', 'Nguyễn Hoàng Link',  '02439488888', 'ACTIVE', false, 'MONTHLY');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. CARGO TYPES
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO cargo_types (name, requires_photos) VALUES
  ('Container khô',     false),
  ('Container lạnh',    false),
  ('Hàng rời',          true),
  ('Hàng siêu trường',  true),
  ('Nguyên vật liệu',   false);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 7. ROUTES  (Hai Phong hub routes — realistic distances & names)
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO routes (name, distance_km, is_mountain, tolls_stations, driver_salary, default_legs) VALUES
  ('HP → HCM (Nam)',   1750, false, 8, '1500000',
   '[{"origin":"Cảng Đình Vũ, HP","destination":"ICD Thủ Đức, HCM","km":1750,"loadingType":"HANG"}]'::jsonb),
  ('HP → Đà Nẵng',     780,  false, 4, '800000',
   '[{"origin":"Cảng Lạch Huyện, HP","destination":"ICD Đà Nẵng","km":780,"loadingType":"HANG"}]'::jsonb),
  ('HP → Hà Nội',      120,  false, 1, '350000',
   '[{"origin":"Cảng Đình Vũ, HP","destination":"ICD Nội Bài, HN","km":120,"loadingType":"HANG"}]'::jsonb),
  ('HP → Ninh Bình',   200,  false, 2, '400000',
   '[{"origin":"Cảng Hải Phòng","destination":"KCN Khánh Phú, NB","km":200,"loadingType":"HANG"}]'::jsonb),
  ('HP → Nghệ An',     320,  false, 3, '550000',
   '[{"origin":"Cảng Đình Vũ, HP","destination":"KCN VSIP Nghệ An","km":320,"loadingType":"HANG"}]'::jsonb),
  ('HP → Thanh Hóa',   260,  false, 2, '450000',
   '[{"origin":"Cảng Lạch Huyện, HP","destination":"KCN Lễ Môn, TH","km":260,"loadingType":"HANG"}]'::jsonb),
  ('HP → Quảng Ninh',   60,  false, 1, '250000',
   '[{"origin":"Cảng Hải Phòng","destination":"Cảng Cái Lân, QN","km":60,"loadingType":"HANG"}]'::jsonb),
  ('HP → Bình Dương',  1780, false, 8, '1500000',
   '[{"origin":"Cảng Đình Vũ, HP","destination":"KCN Sóng Thần, BD","km":1780,"loadingType":"HANG"}]'::jsonb),
  ('HP → Hải Dương',    55,  false, 1, '250000',
   '[{"origin":"Cảng Hải Phòng","destination":"KCN Tân Trường, HD","km":55,"loadingType":"HANG"}]'::jsonb),
  ('HP → Đồng Nai',    1800, false, 9, '1550000',
   '[{"origin":"Cảng Lạch Huyện, HP","destination":"KCN Biên Hòa, ĐN","km":1800,"loadingType":"HANG"}]'::jsonb),
  ('HCM → HP (Bắc)',   1750, false, 8, '1500000',
   '[{"origin":"ICD Thủ Đức, HCM","destination":"Cảng Đình Vũ, HP","km":1750,"loadingType":"HANG"}]'::jsonb),
  ('ĐN → HP (Bắc)',     780, false, 4, '800000',
   '[{"origin":"ICD Đà Nẵng","destination":"Cảng Đình Vũ, HP","km":780,"loadingType":"HANG"}]'::jsonb);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 8. PRICING TABLES  (customer-route pricing, VND per trip)
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO pricing_tables (customer_id, route_id, price, effective_date) VALUES
  (1,1,'5500000','2026-01-01'), (1,2,'2800000','2026-01-01'), (1,3,'1200000','2026-01-01'),
  (1,4,'1400000','2026-01-01'), (1,8,'5800000','2026-01-01'),
  (2,1,'5200000','2026-01-01'), (2,3,'1100000','2026-01-01'), (2,5,'1800000','2026-01-01'),
  (3,1,'5300000','2026-01-01'), (3,7,'800000','2026-01-01'),  (3,9,'700000','2026-01-01'),
  (4,2,'2600000','2026-01-01'), (4,6,'1600000','2026-01-01'), (4,10,'5600000','2026-01-01'),
  (5,1,'5100000','2026-01-01'), (5,8,'5500000','2026-01-01'), (5,11,'5000000','2026-01-01'),
  (6,4,'1350000','2026-01-01'), (6,5,'1700000','2026-01-01'), (6,6,'1500000','2026-01-01'),
  (7,3,'1050000','2026-01-01'), (7,9,'650000','2026-01-01'),  (7,7,'750000','2026-01-01'),
  (8,1,'5400000','2026-01-01'), (8,12,'2700000','2026-01-01'),(8,7,'820000','2026-01-01'),
  (9,1,'5000000','2026-01-01'), (9,8,'5400000','2026-01-01'), (9,10,'5500000','2026-01-01'),
  (10,2,'2700000','2026-01-01'),(10,1,'5350000','2026-01-01'),(10,3,'1150000','2026-01-01');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 9. ROAD ALLOWANCES
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO road_allowances (route_id, trailer_type, base_amount) VALUES
  (1,'40FT','1850000'), (1,'20FT','1500000'),
  (2,'40FT','820000'),  (2,'20FT','680000'),
  (3,'40FT','200000'),  (3,'20FT','170000'),
  (4,'40FT','280000'),  (4,'20FT','230000'),
  (5,'40FT','400000'),  (5,'20FT','330000'),
  (6,'40FT','350000'),  (6,'20FT','290000'),
  (7,'40FT','130000'),  (7,'20FT','110000'),
  (8,'40FT','1900000'), (8,'20FT','1550000'),
  (9,'40FT','120000'),  (9,'20FT','100000'),
  (10,'40FT','1950000'),(10,'20FT','1600000'),
  (11,'40FT','1850000'),(11,'20FT','1500000'),
  (12,'40FT','820000'), (12,'20FT','680000');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 10. EXPENSE CATEGORIES
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO expense_categories (name, is_renewable, reminder_lead_days, status) VALUES
  ('Sửa chữa',     false, NULL, 'ACTIVE'),
  ('Phụ tùng',     false, NULL, 'ACTIVE'),
  ('Vật tư',       false, NULL, 'ACTIVE'),
  ('Bảo hiểm',     true,  30,   'ACTIVE'),
  ('Đăng kiểm',    true,  30,   'ACTIVE'),
  ('Phí đường bộ', true,  30,   'ACTIVE'),
  ('Xăng dầu',     false, NULL, 'ACTIVE'),
  ('Phí cầu đường',false, NULL, 'ACTIVE');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 11. FUEL CONFIG  (realistic diesel prices in Vietnam ~22,000 VND/liter)
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO fuel_config (loaded_norm, empty_norm, supplement, unit_price) VALUES
  ('32.00', '24.00', '3', '22870');

INSERT INTO fuel_price_history (unit_price, effective_date, note) VALUES
  ('22150', '2026-01-01', 'Giá đầu năm 2026'),
  ('22430', '2026-02-15', 'Điều chỉnh tăng'),
  ('22680', '2026-03-20', 'Điều chỉnh tăng'),
  ('22870', '2026-05-10', 'Giá hiện tại');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 12. PENALTY REASONS
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO penalty_reasons (reason_text, default_amount, severity) VALUES
  ('Đi trễ',                        '100000', 'low'),
  ('Vi phạm tốc độ',                '200000', 'mid'),
  ('Sử dụng điện thoại khi lái xe', '300000', 'mid'),
  ('Không tuân thủ tuyến đường',    '200000', 'mid'),
  ('Xe không sạch sẽ',              '50000',  'low'),
  ('Thiếu giấy tờ',                 '150000', 'mid'),
  ('Không đội mũ bảo hiểm',         '100000', 'low'),
  ('Lái xe khi say xỉn',           '1000000','high');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 13. CONTAINER TYPES & PORTS
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO container_types (code, name, notes) VALUES
  ('20DC', '20''DC', 'Container khô tiêu chuẩn 20 feet'),
  ('20OT', '20''OT', 'Container mở nóc (Open Top) 20 feet'),
  ('20RF', '20''RF', 'Container lạnh (Reefer) 20 feet'),
  ('40DC', '40''DC', 'Container khô tiêu chuẩn 40 feet'),
  ('40HC', '40''HC', 'Container khô cao (High Cube) 40 feet'),
  ('40RF', '40''RF', 'Container lạnh (Reefer) 40 feet'),
  ('45HC', '45''HC', 'Container khô cao 45 feet');

INSERT INTO ports (name, code, city, address) VALUES
  ('Cảng Hải Phòng',              'HPH',  'Hải Phòng', 'Quận Hồng Bàng, Hải Phòng'),
  ('Cảng Đình Vũ',                'DVU',  'Hải Phòng', 'Đông Hải 2, Hải An, Hải Phòng'),
  ('TC - HICT',                    'HICT', 'Hải Phòng', 'Cát Hải, Hải Phòng'),
  ('Cảng Tân Cảng 128 HP',        'TC128','Hải Phòng', 'Hùng Vương, Hồng Bàng, Hải Phòng'),
  ('Cảng Tân Vũ',                 'TVU',  'Hải Phòng', 'Đông Hải 2, Hải An, Hải Phòng'),
  ('Cảng Nam Hải Đình Vũ',        'NHDV', 'Hải Phòng', 'Đông Hải 2, Hải An, Hải Phòng'),
  ('Cảng VIP Greenport',          'VIPG', 'Hải Phòng', 'Đông Hải 2, Hải An, Hải Phòng'),
  ('ICD Hoàng Thành',             'HTHA', 'Hải Phòng', 'An Dương, Hải Phòng'),
  ('ICD Thủ Đức',                 'TDHCM','Hồ Chí Minh','Thủ Đức, Hồ Chí Minh'),
  ('Cảng Cát Lái',                'CLHCM','Hồ Chí Minh','Thủ Đức, Hồ Chí Minh'),
  ('ICD Đà Nẵng',                 'ICDDN','Đà Nẵng',   'Liên Chiểu, Đà Nẵng'),
  ('ICD Nội Bài',                 'NBHN', 'Hà Nội',    'Sóc Sơn, Hà Nội'),
  ('KCN Sóng Thần',               'STBD', 'Bình Dương','Dĩ An, Bình Dương'),
  ('KCN Biên Hòa',                'BHDN', 'Đồng Nai',  'Biên Hòa, Đồng Nai');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 14. FORWARDER EXPENSE TYPES
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO forwarder_expense_types (code, name, status, default_markup, billing_label, vat_rate) VALUES
  ('LIFTING',      'Nâng hạ',              'ACTIVE', false, 'Phí nâng hạ',          '0.080'),
  ('CUSTOMS',      'Hải quan',             'ACTIVE', false, 'Phí hải quan',         '0.080'),
  ('PORT_FEE',     'Phí cảng',             'ACTIVE', false, 'Phí cảng',             '0.080'),
  ('STORAGE',      'Lưu bãi',              'ACTIVE', false, 'Phí lưu bãi',          '0.080'),
  ('DOCUMENT',     'Phí chứng từ',         'ACTIVE', false, 'Phí chứng từ',         '0.080'),
  ('TRANSPORT',    'Vận chuyển nội địa',   'ACTIVE', true,  'Cước vận chuyển',      '0.080'),
  ('WEIGHING',     'Cân xe',               'ACTIVE', false, 'Phí cân xe',           '0.080'),
  ('CLEANING',     'Vệ sinh container',    'ACTIVE', false, 'Phí vệ sinh',          '0.080'),
  ('INSPECTION',   'Kiểm hóa',             'ACTIVE', false, 'Phí kiểm hóa',         '0.080'),
  ('COMBINED',     'Phí combo (Nâng+Cảng)','ACTIVE', false, 'Phí combo nâng+cảng',  '0.080'),
  ('FUMIGATION',   'Huỷ trùng',            'ACTIVE', false, 'Phí huỷ trùng',        '0.080'),
  (' SEAL',        'Chì số',               'ACTIVE', false, 'Phí chì số',           '0.080');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 15. ROAD CONFIG
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO road_config (toll_per_station, return_cargo_bonus, default_driver_salary, two_point_delivery_bonus, vehicle_shift_default) VALUES
  ('55000', '200000', '400000', '200000', '200000');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 16. CAP TABLE
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO cap_table_history (partner_name, contribution_amount, percentage, effective_date) VALUES
  ('Ông Thương', '0', '60.00', '2026-01-01'),
  ('Bà Hạnh',   '0', '40.00', '2026-01-01');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 17. TRIPS  (30 realistic trips, May-June 2026)
-- ═══════════════════════════════════════════════════════════════════════════════
-- Status distribution: 5 CREATED, 3 IN_TRANSIT, 18 COMPLETED, 3 LOCKED, 1 CANCELED

-- Helper: trip codes follow pattern VT-YYMM-NNN
INSERT INTO trip_code_counters (year_month, counter) VALUES
  ('2026-05', 12),
  ('2026-06', 18);

-- --- May trips (all completed/locked) ---

INSERT INTO trips (trip_code, created_by, customer_id, customer_reference, truck_id, driver_id, route_id, trailer_type, cargo_type_id, container_count, status, departure_date, fuel_mode, tolls_stations, driver_salary, fuel_price_applied, fuel_loaded_norm_applied, fuel_empty_norm_applied, fuel_supplement_norm_applied, toll_per_station_applied, fuel_liters, total_fuel_cost, total_road_allowance, total_cost, revenue, gross_profit, vat_rate) VALUES
  ('VT-2605-001', 5, 1,  'GD-2026-0501', 1, 1, 1, '40FT', 1, 1, 'LOCKED', '2026-05-02', 'AUTO', 8, '1500000', '22430', '32.00', '24.00', '3', '55000', '106.40', '2388092', '1850000', '5738092', '5500000', '-238092', '0.080'),
  ('VT-2605-002', 5, 2,  'TCSG-0502',   2, 2, 3, '40FT', 1, 1, 'LOCKED', '2026-05-03', 'AUTO', 1, '350000',  '22430', '32.00', '24.00', '3', '55000', '10.24',  '229733',  '200000',  '779733',  '1100000', '320267',  '0.080'),
  ('VT-2605-003', 5, 3,  'HA-0503',     3, 3, 7, '20FT', 1, 1, 'COMPLETED','2026-05-04','AUTO', 1, '250000',  '22430', '32.00', '24.00', '3', '55000', '5.76',   '129195',  '110000',  '489195',  '800000',  '310805',  '0.080'),
  ('VT-2605-004', 5, 4,  'LOG-0505',    4, 4, 2, '40FT', 1, 2, 'COMPLETED','2026-05-05','AUTO', 4, '800000',  '22430', '32.00', '24.00', '3', '55000', '50.56',  '1135061', '820000',  '2755061', '2600000', '-155061', '0.080'),
  ('VT-2605-005', 5, 5,  'BD-0506',     1, 1, 8, '40FT', 1, 1, 'COMPLETED','2026-05-06','AUTO', 8, '1500000', '22430', '32.00', '24.00', '3', '55000', '108.80', '2442368', '1900000', '5842368', '5500000', '-342368', '0.080'),
  ('VT-2605-006', 5, 6,  'TB-0507',     5, 5, 4, '20FT', 1, 1, 'COMPLETED','2026-05-07','AUTO', 2, '400000',  '22430', '32.00', '24.00', '3', '55000', '14.08',  '315975',  '230000',  '945975',  '1350000', '404025',  '0.080'),
  ('VT-2605-007', 5, 7,  'NM-0508',     6, 6, 9, '20FT', 1, 1, 'COMPLETED','2026-05-08','AUTO', 1, '250000',  '22430', '32.00', '24.00', '3', '55000', '6.40',   '143550',  '100000',  '493550',  '650000',  '156450',  '0.080'),
  ('VT-2605-008', 5, 1,  'GD-0510',     2, 2, 2, '40FT', 1, 1, 'COMPLETED','2026-05-10','AUTO', 4, '800000',  '22680', '32.00', '24.00', '3', '55000', '50.56',  '1147621', '820000', '2767621', '2800000', '32379',   '0.080'),
  ('VT-2605-009', 5, 8,  'VT-0512',     3, 3, 1, '40FT', 1, 1, 'LOCKED',  '2026-05-12', 'AUTO', 8, '1500000', '22680', '32.00', '24.00', '3', '55000', '106.40', '2415168', '1850000', '5765168', '5400000', '-365168', '0.080'),
  ('VT-2605-010', 5, 9,  'HK-0513',     4, 4, 5, '40FT', 1, 1, 'COMPLETED','2026-05-13','AUTO', 3, '550000',  '22680', '32.00', '24.00', '3', '55000', '22.40',  '508032',  '400000',  '1458032', '1700000', '241968',  '0.080'),
  ('VT-2605-011', 5, 10, 'VL-0515',     1, 1, 3, '40FT', 1, 1, 'COMPLETED','2026-05-15','AUTO', 1, '350000',  '22680', '32.00', '24.00', '3', '55000', '10.24',  '232254',  '200000',  '782254',  '1150000', '367746',  '0.080'),
  ('VT-2605-012', 5, 2,  'TCSG-0517',   5, 5, 1, '40FT', 1, 2, 'COMPLETED','2026-05-17','AUTO', 8, '1500000', '22870', '32.00', '24.00', '3', '55000', '106.40', '2435477', '1850000', '5785477', '5200000', '-585477', '0.080');

-- --- June trips ---
INSERT INTO trips (trip_code, created_by, customer_id, customer_reference, truck_id, driver_id, route_id, trailer_type, cargo_type_id, container_count, status, departure_date, fuel_mode, tolls_stations, driver_salary, fuel_price_applied, fuel_loaded_norm_applied, fuel_empty_norm_applied, fuel_supplement_norm_applied, toll_per_station_applied, fuel_liters, total_fuel_cost, total_road_allowance, total_cost, revenue, gross_profit, vat_rate) VALUES
  ('VT-2606-001', 5, 1,  'GD-0601',     6, 6, 6, '20FT', 1, 1, 'LOCKED',   '2026-06-01', 'AUTO', 2, '450000', '22870', '32.00', '24.00', '3', '55000', '18.56',  '424491',  '290000',  '1164491', '1500000', '335509',  '0.080'),
  ('VT-2606-002', 5, 3,  'HA-0602',     1, 1, 1, '40FT', 1, 2, 'COMPLETED','2026-06-02', 'AUTO', 8, '1500000', '22870', '32.00', '24.00', '3', '55000', '107.68', '2464062', '1850000', '5814062', '5300000', '-514062', '0.080'),
  ('VT-2606-003', 5, 4,  'LOG-0603',    2, 2, 10,'40FT', 1, 1, 'COMPLETED','2026-06-03', 'AUTO', 9, '1550000', '22870', '32.00', '24.00', '3', '55000', '110.08', '2518930', '1950000', '6018930', '5600000', '-418930', '0.080'),
  ('VT-2606-004', 5, 5,  'BD-0604',     3, 3, 11,'40FT', 1, 1, 'COMPLETED','2026-06-04', 'AUTO', 8, '1500000', '22870', '32.00', '24.00', '3', '55000', '106.40', '2435477', '1850000', '5785477', '5000000', '-785477', '0.080'),
  ('VT-2606-005', 5, 6,  'TB-0605',     4, 4, 4, '20FT', 1, 1, 'COMPLETED','2026-06-05', 'AUTO', 2, '400000',  '22870', '32.00', '24.00', '3', '55000', '14.08',  '322264',  '230000',  '952264',  '1350000', '397736',  '0.080'),
  ('VT-2606-006', 5, 7,  'NM-0605',     5, 5, 3, '20FT', 1, 1, 'COMPLETED','2026-06-05', 'AUTO', 1, '350000',  '22870', '32.00', '24.00', '3', '55000', '10.24',  '234187',  '170000',  '754187',  '1050000', '295813',  '0.080'),
  ('VT-2606-007', 5, 8,  'VT-0606',     1, 1, 7, '40FT', 1, 1, 'COMPLETED','2026-06-06', 'AUTO', 1, '250000',  '22870', '32.00', '24.00', '3', '55000', '5.76',   '131731',  '130000',  '511731',  '820000',  '308269',  '0.080'),
  ('VT-2606-008', 5, 9,  'HK-0606',     2, 2, 8, '40FT', 1, 1, 'IN_TRANSIT','2026-06-06','AUTO', 8, '1500000', '22870', '32.00', '24.00', '3', '55000', '108.80', '2489208', '1900000', '5889208', '5400000', '-489208', '0.080'),
  ('VT-2606-009', 5, 10, 'VL-0606',     3, 3, 2, '40FT', 1, 1, 'IN_TRANSIT','2026-06-06','AUTO', 4, '800000',  '22870', '32.00', '24.00', '3', '55000', '50.56',  '1156761', '820000',  '2776761', '2700000', '-76761',  '0.080'),
  ('VT-2606-010', 5, 1,  'GD-0606',     4, 4, 5, '40FT', 1, 1, 'IN_TRANSIT','2026-06-06','AUTO', 3, '550000',  '22870', '32.00', '24.00', '3', '55000', '22.40',  '512288',  '400000',  '1462288', '1800000', '337712',  '0.080'),
  ('VT-2606-011', 5, 2,  'TCSG-0607',   5, 5, 9, '20FT', 1, 1, 'CREATED',  '2026-06-07', 'AUTO', 1, '250000',  '22870', '32.00', '24.00', '3', '55000', '6.40',   '146368',  '100000',  '496368',  '700000',  '203632',  '0.080'),
  ('VT-2606-012', 5, 3,  'HA-0607',     6, 6, 1, '40FT', 1, 1, 'CREATED',  '2026-06-07', 'AUTO', 8, '1500000', '22870', '32.00', '24.00', '3', '55000', '106.40', '2435477', '1850000', '5785477', '5300000', '-485477', '0.080'),
  ('VT-2606-013', 5, 4,  'LOG-0608',    1, 1, 6, '40FT', 1, 1, 'CREATED',  '2026-06-08', 'AUTO', 2, '450000',  '22870', '32.00', '24.00', '3', '55000', '18.56',  '424491',  '350000',  '1224491', '1600000', '375509',  '0.080'),
  ('VT-2606-014', 5, 5,  'BD-0609',     2, 2, 10,'40FT', 1, 2, 'CREATED',  '2026-06-09', 'AUTO', 9, '1550000', '22870', '32.00', '24.00', '3', '55000', '110.08', '2518930', '1950000', '6018930', '5500000', '-518930', '0.080'),
  ('VT-2606-015', 5, 6,  'TB-0610',     3, 3, 5, '20FT', 1, 1, 'CREATED',  '2026-06-10', 'AUTO', 3, '550000',  '22870', '32.00', '24.00', '3', '55000', '22.40',  '512288',  '330000',  '1392288', '1700000', '307712',  '0.080'),
  ('VT-2606-016', 5, 7,  'NM-0610',     4, 4, 7, '20FT', 1, 1, 'CANCELED', '2026-06-10', 'AUTO', 1, '250000',  '22870', '32.00', '24.00', '3', '55000', NULL,     NULL,       NULL,      NULL,       NULL,       NULL,       '0.080'),
  ('VT-2606-017', 5, 8,  'VT-0611',     5, 5, 12,'40FT', 1, 1, 'COMPLETED','2026-06-06', 'AUTO', 4, '800000',  '22870', '32.00', '24.00', '3', '55000', '50.56',  '1156761', '820000',  '2776761', '2700000', '-76761',  '0.080'),
  ('VT-2606-018', 5, 9,  'HK-0612',     6, 6, 1, '40FT', 1, 1, 'CREATED',  '2026-06-12', 'AUTO', 8, '1500000', '22870', '32.00', '24.00', '3', '55000', '106.40', '2435477', '1850000', '5785477', '5000000', '-785477', '0.080');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 18. TRIP LEGS  (for all trips, using route default_legs)
-- ═══════════════════════════════════════════════════════════════════════════════

-- Use a simple 1-leg pattern matching the route for each trip
INSERT INTO trip_legs (trip_id, sequence, origin, destination, km, loading_type, calculated_liters)
SELECT t.id, 1,
  CASE t.route_id
    WHEN 1  THEN 'Cảng Đình Vũ, HP'      WHEN 2  THEN 'Cảng Lạch Huyện, HP'
    WHEN 3  THEN 'Cảng Đình Vũ, HP'      WHEN 4  THEN 'Cảng Hải Phòng'
    WHEN 5  THEN 'Cảng Đình Vũ, HP'      WHEN 6  THEN 'Cảng Lạch Huyện, HP'
    WHEN 7  THEN 'Cảng Hải Phòng'        WHEN 8  THEN 'Cảng Đình Vũ, HP'
    WHEN 9  THEN 'Cảng Hải Phòng'        WHEN 10 THEN 'Cảng Lạch Huyện, HP'
    WHEN 11 THEN 'ICD Thủ Đức, HCM'      WHEN 12 THEN 'ICD Đà Nẵng'
  END,
  CASE t.route_id
    WHEN 1  THEN 'ICD Thủ Đức, HCM'      WHEN 2  THEN 'ICD Đà Nẵng'
    WHEN 3  THEN 'ICD Nội Bài, HN'       WHEN 4  THEN 'KCN Khánh Phú, NB'
    WHEN 5  THEN 'KCN VSIP Nghệ An'      WHEN 6  THEN 'KCN Lễ Môn, TH'
    WHEN 7  THEN 'Cảng Cái Lân, QN'      WHEN 8  THEN 'KCN Sóng Thần, BD'
    WHEN 9  THEN 'KCN Tân Trường, HD'    WHEN 10 THEN 'KCN Biên Hòa, ĐN'
    WHEN 11 THEN 'Cảng Đình Vũ, HP'      WHEN 12 THEN 'Cảng Đình Vũ, HP'
  END,
  COALESCE(r.distance_km, 100),
  'HANG',
  t.fuel_liters::numeric
FROM trips t
JOIN routes r ON r.id = t.route_id
WHERE t.status != 'CANCELED';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 19. TRIP EXPENSES (forwarder expenses for completed/locked trips)
-- ═══════════════════════════════════════════════════════════════════════════════

-- Sample forwarder expenses for a few trips
INSERT INTO trip_expenses (trip_id, forwarder_id, expense_type, buy_amount, sell_amount, settlement_method, approval_status, note) VALUES
  -- Trip 1 (VT-2605-001): HP→HCM for Gemadept
  (1,  5, 'LIFTING',   '3200000', '3500000',  'FORWARDER_ADVANCE', 'APPROVED', 'Nâng hạ 1x40HC tại Cảng Đình Vũ'),
  (1,  5, 'CUSTOMS',   '850000',  '950000',   'FORWARDER_ADVANCE', 'APPROVED', 'Hải quan xuất khẩu'),
  (1,  5, 'PORT_FEE',  '1200000', '1350000',  'FORWARDER_ADVANCE', 'APPROVED', 'Phí cảng Đình Vũ'),
  -- Trip 2 (VT-2605-002): HP→HN for Tân Cảng SG
  (2,  5, 'LIFTING',   '1800000', '2000000',  'FORWARDER_ADVANCE', 'APPROVED', 'Nâng hạ 1x40DC'),
  (2,  5, 'TRANSPORT', '900000',  '1100000',  'FORWARDER_ADVANCE', 'APPROVED', 'Vận chuyển nội địa'),
  -- Trip 4 (VT-2605-004): HP→ĐN for Logistico
  (4,  5, 'LIFTING',   '5600000', '6200000',  'FORWARDER_ADVANCE', 'APPROVED', 'Nâng hạ 2x40HC'),
  (4,  5, 'CUSTOMS',   '1500000', '1700000',  'FORWARDER_ADVANCE', 'APPROVED', 'Hải quan 2 container'),
  (4,  5, 'PORT_FEE',  '2200000', '2500000',  'FORWARDER_ADVANCE', 'APPROVED', 'Phí cảng Lạch Huyện'),
  (4,  5, 'STORAGE',   '450000',  '500000',   'FORWARDER_ADVANCE', 'APPROVED', 'Lưu bãi 2 ngày'),
  -- Trip 9 (VT-2605-009): HP→HCM for VT Container
  (9,  5, 'LIFTING',   '3200000', '3500000',  'FORWARDER_ADVANCE', 'APPROVED', 'Nâng hạ 1x40HC'),
  (9,  5, 'CUSTOMS',   '800000',  '900000',   'FORWARDER_ADVANCE', 'APPROVED', 'Hải quan XK'),
  (9,  5, 'PORT_FEE',  '1100000', '1250000',  'FORWARDER_ADVANCE', 'APPROVED', 'Phí cảng'),
  (9,  5, 'DOCUMENT',  '350000',  '400000',   'FORWARDER_ADVANCE', 'APPROVED', 'Phí chứng từ VGM/B/L'),
  -- Trip 12 (VT-2605-012): HP→HCM for Tân Cảng SG
  (12, 5, 'LIFTING',   '6400000', '7200000',  'FORWARDER_ADVANCE', 'APPROVED', 'Nâng hạ 2x40HC'),
  (12, 5, 'CUSTOMS',   '1600000', '1800000',  'FORWARDER_ADVANCE', 'APPROVED', 'Hải quan 2 cont'),
  (12, 5, 'PORT_FEE',  '2400000', '2700000',  'FORWARDER_ADVANCE', 'APPROVED', 'Phí cảng Lạch Huyện'),
  (12, 5, 'WEIGHING',  '300000',  '350000',   'FORWARDER_ADVANCE', 'APPROVED', 'Cân xe 2 cont'),
  -- Trip 14 (VT-2606-001): HP→TH for Thái Bình (locked)
  (14, 5, 'LIFTING',   '1600000', '1800000',  'FORWARDER_ADVANCE', 'APPROVED', 'Nâng hạ 1x20DC'),
  (14, 5, 'CUSTOMS',   '600000',  '680000',   'FORWARDER_ADVANCE', 'APPROVED', 'Hải quan');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 20. LEDGER ENTRIES  (revenue for completed/locked trips)
-- ═══════════════════════════════════════════════════════════════════════════════

-- Customer receivables (TRIP_REVENUE)
INSERT INTO ledger (timestamp, txn_type, entity_type, entity_id, debit, credit, balance, note)
SELECT
  t.created_at,
  'TRIP_REVENUE',
  'CUSTOMER',
  t.customer_id,
  t.revenue,
  '0',
  t.revenue,
  'Doanh thu chuyến ' || t.trip_code
FROM trips t
WHERE t.status IN ('COMPLETED', 'LOCKED') AND t.revenue IS NOT NULL
ORDER BY t.id;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 21. EXPENSES  (vehicle operating expenses)
-- ═══════════════════════════════════════════════════════════════════════════════

-- Get category IDs dynamically
INSERT INTO expenses (expense_date, supplier_id, category_id, truck_id, vehicle_component, amount, payment_status, note) VALUES
  ('2026-05-02', 1, (SELECT id FROM expense_categories WHERE name='Xăng dầu'),    1, 'TRUCK'::vehicle_component, 2388092, 'PAID', 'Nhiên liệu chuyến VT-2605-001 HP→HCM'),
  ('2026-05-03', 1, (SELECT id FROM expense_categories WHERE name='Xăng dầu'),    2, 'TRUCK'::vehicle_component, 229733,  'PAID', 'Nhiên liệu chuyến VT-2605-002 HP→HN'),
  ('2026-05-04', 1, (SELECT id FROM expense_categories WHERE name='Xăng dầu'),    3, 'TRUCK'::vehicle_component, 129195,  'PAID', 'Nhiên liệu chuyến VT-2605-003 HP→QN'),
  ('2026-05-05', 1, (SELECT id FROM expense_categories WHERE name='Xăng dầu'),    4, 'TRUCK'::vehicle_component, 1135061, 'PAID', 'Nhiên liệu chuyến VT-2605-004 HP→ĐN'),
  ('2026-05-06', 1, (SELECT id FROM expense_categories WHERE name='Xăng dầu'),    1, 'TRUCK'::vehicle_component, 2442368, 'PAID', 'Nhiên liệu chuyến VT-2605-005 HP→BD'),
  ('2026-05-10', 3, (SELECT id FROM expense_categories WHERE name='Sửa chữa'),    3, 'TRUCK'::vehicle_component, 3500000, 'PAID', 'Thay bộ phanh trước'),
  ('2026-05-15', 6, (SELECT id FROM expense_categories WHERE name='Phụ tùng'),    1, 'TRUCK'::vehicle_component, 1200000, 'PAID', 'Thay lốp dự phòng'),
  ('2026-05-20', 3, (SELECT id FROM expense_categories WHERE name='Sửa chữa'),    2, 'TRUCK'::vehicle_component, 2800000, 'PAID', 'Bảo dưỡng định kỳ 50,000km'),
  ('2026-05-25', 6, (SELECT id FROM expense_categories WHERE name='Phụ tùng'),    4, 'TRAILER'::vehicle_component, 850000, 'PAID', 'Thay chốt rơ moóc'),
  ('2026-06-01', 3, (SELECT id FROM expense_categories WHERE name='Sửa chữa'),    5, 'TRUCK'::vehicle_component, 4500000, 'UNPAID','Sửa hệ thống làm mát'),
  ('2026-05-01', 5, (SELECT id FROM expense_categories WHERE name='Bảo hiểm'),    1, 'TRUCK'::vehicle_component, 12000000,'PAID', 'Bảo hiểm thân vỏ 2026'),
  ('2026-05-01', 5, (SELECT id FROM expense_categories WHERE name='Bảo hiểm'),    2, 'TRUCK'::vehicle_component, 12000000,'PAID', 'Bảo hiểm thân vỏ 2026'),
  ('2026-05-01', 4, (SELECT id FROM expense_categories WHERE name='Đăng kiểm'),   1, 'TRUCK'::vehicle_component, 560000,  'PAID', 'Đăng kiểm định kỳ'),
  ('2026-05-01', 4, (SELECT id FROM expense_categories WHERE name='Đăng kiểm'),   2, 'TRUCK'::vehicle_component, 560000,  'PAID', 'Đăng kiểm định kỳ'),
  ('2026-06-01', 1, (SELECT id FROM expense_categories WHERE name='Phí cầu đường'),1,'TRUCK'::vehicle_component,1650000,'PAID', 'Phí cầu đường tháng 6'),
  ('2026-06-01', 1, (SELECT id FROM expense_categories WHERE name='Phí cầu đường'),2,'TRUCK'::vehicle_component,1650000,'PAID', 'Phí cầu đường tháng 6');

COMMIT;
