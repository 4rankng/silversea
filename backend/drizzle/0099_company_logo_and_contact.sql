
-- Company logo + contact fields move into app_settings as a single source of
-- truth, edited at /config/company-info. The per-template logo column is
-- removed — the company logo now renders on every XLSX that carries company
-- info. See services/company-info.service.ts for the field→key map + defaults.
ALTER TABLE "debit_note_templates" DROP COLUMN IF EXISTS "logo_storage_key";

-- Seed the two new contact rows so existing exports keep showing phone/email
-- until an admin saves new values. Mirrors COMPANY_INFO_DEFAULTS; keep in sync
-- when the company's contact profile changes. (company.logo_storage_key is
-- deliberately not seeded — row absence reads back as null, which renders the
-- configured company.name as the header text until a logo is uploaded.)
INSERT INTO "app_settings" ("setting_key", "setting_value") VALUES
  ('company.phone', '0225-8832393'),
  ('company.email', 'acc@nepocorp.com')
ON CONFLICT ("setting_key") DO NOTHING;
