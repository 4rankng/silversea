
-- Overhaul debit-note templates from fixed column toggles to a real column
-- builder. The JSON shape is validated by shared/src/schemas before writes.
ALTER TABLE "debit_note_templates"
  ADD COLUMN IF NOT EXISTS "columns" jsonb NOT NULL DEFAULT '[]'::jsonb;--> statement-breakpoint

-- Snapshot trip-facing render values on saved billing lines so future exports
-- do not need to re-query mutable trip/container records.
ALTER TABLE "billing_document_lines"
  ADD COLUMN IF NOT EXISTS "render_data" jsonb;--> statement-breakpoint

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
