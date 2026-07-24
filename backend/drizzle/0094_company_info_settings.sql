CREATE TABLE "app_settings" (
	"setting_key" varchar(120) PRIMARY KEY NOT NULL,
	"setting_value" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

-- Values mirror COMPANY_INFO_DEFAULTS in
-- backend/src/services/company-info.service.ts (single source for the TS paths:
-- routes/config.ts + seed.ts). Update both when the company's legal profile
-- changes. This DDL seed is the authoritative source for prod bootstrap.
INSERT INTO "app_settings" ("setting_key", "setting_value") VALUES
	('company.name', 'CÔNG TY TNHH NEPO'),
	('company.address', 'Số 26/63/36 đường Vạn Mỹ, Phường Ngô Quyền, Thành phố Hải Phòng, Việt Nam'),
	('company.tax_code', '0201588208'),
	('company.representative', 'Ông Phan Kim Phụng'),
	('company.representative_title', 'Giám Đốc'),
	('company.bank_account', '190466529'),
	('company.bank_name', 'Ngân hàng TMCP Á Châu PGD Thái Phiên - Hải Phòng')
ON CONFLICT ("setting_key") DO NOTHING;
