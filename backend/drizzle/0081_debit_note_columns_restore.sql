
-- Restore the debit-note column-builder columns that migration 0079 was supposed
-- to add, but which drizzle silently SKIPPED in some environments (incl. prod).
-- Root cause: 0079's journal `when` (1782482778690) predates the already-applied
-- migration 0077 (1782490000000). drizzle-orm decides "pending" by
-- `when > max(created_at)` — NOT by hash — so it treated 0079 as already-applied
-- and never ran it. The deployed Drizzle schema requires `columns`, so every
-- debit-note-template query failed with `column "columns" does not exist` → 500.
-- Same class of bug as the service-fee desync. This forward-dated idempotent
-- migration guarantees the columns exist everywhere on the next deploy.

ALTER TABLE "debit_note_templates"
  ADD COLUMN IF NOT EXISTS "columns" jsonb NOT NULL DEFAULT '[]'::jsonb;--> statement-breakpoint

ALTER TABLE "billing_document_lines"
  ADD COLUMN IF NOT EXISTS "render_data" jsonb;--> statement-breakpoint

-- Seed the standard 12-column layout onto any template still carrying the empty
-- default (e.g. the "Mặc định" row from migration 0077). User-built templates
-- already supply their own columns array via the editor, so this never
-- overwrites a deliberately-configured template. Guarded by `columns = '[]'`
-- so the migration is fully re-runnable / idempotent.
UPDATE "debit_note_templates"
SET "columns" = '[
  {"id":"stt","label":"Stt","variable":"rowIndex","width":6,"align":"center","format":"number"},
  {"id":"ngay","label":"Ngày\nthực hiện","variable":"departureDate","width":12,"align":"center","format":"date"},
  {"id":"bien_so","label":"Biển số xe","variable":"truckPlate","width":12,"align":"center","format":"text"},
  {"id":"dong_tra","label":"Đóng/ Trả","variable":"actionType","width":10,"align":"center","format":"text"},
  {"id":"diem_di","label":"Điểm đi/ về","variable":"origin","width":24,"align":"left","format":"text"},
  {"id":"diem_hang","label":"Điểm đóng/ trả hàng","variable":"destination","width":32,"align":"left","format":"text"},
  {"id":"dia_chi_hang","label":"Điểm đóng/ trả hàng","variable":"deliveryAddress","width":40,"align":"left","format":"text"},
  {"id":"sl20","label":"20''","variable":"container20Count","width":8,"align":"center","format":"number","total":true},
  {"id":"sl40","label":"40''","variable":"container40Count","width":8,"align":"center","format":"number","total":true},
  {"id":"so_cont","label":"Số hiệu cont","variable":"containerNumbers","width":18,"align":"left","format":"text"},
  {"id":"gia_vc","label":"Giá VC\n(Chưa VAT)","variable":"amount","width":16,"align":"right","format":"currency","total":true},
  {"id":"ghi_chu","label":"Ghi chú","variable":"note","width":14,"align":"left","format":"text"}
]'::jsonb
WHERE "columns" = '[]'::jsonb;--> statement-breakpoint
