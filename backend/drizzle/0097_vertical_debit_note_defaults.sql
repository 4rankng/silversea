
-- Debit notes are vertical fee breakdowns by shipment/container. Earlier
-- migrations seeded the customer-facing DEBIT_NOTE default with the horizontal
-- monthly statement columns (Stt, Biển số xe, Đóng/Trả, ...), which made
-- exports named "giay-bao-no" look like "Bảng kê". Convert active DEBIT_NOTE
-- templates that still carry that horizontal signature to the standard vertical
-- layout. PAYMENT_STATEMENT templates intentionally keep the horizontal layout.
UPDATE "debit_note_templates"
SET
  "columns" = '[
    {"id":"ngay","label":"Ngày tháng","variable":"departureDate","width":12,"align":"center","format":"date","total":false},
    {"id":"chung_tu","label":"Số\nchứng từ","variable":"documentCode","width":12,"align":"center","format":"text","total":false},
    {"id":"dien_giai","label":"Diễn giải","variable":"description","width":52,"align":"left","format":"text","total":false},
    {"id":"dvt","label":"ĐVT","variable":"unit","width":9,"align":"center","format":"text","total":false},
    {"id":"so_luong","label":"Số lượng","variable":"containerCount","width":9,"align":"center","format":"number","total":false},
    {"id":"don_gia","label":"Đơn giá","variable":"amount","width":15,"align":"right","format":"currency","total":false},
    {"id":"thanh_tien","label":"Thành tiền","variable":"amount","width":16,"align":"right","format":"currency","total":true}
  ]'::jsonb,
  "orientation" = 'portrait',
  "grouping_mode" = 'NONE',
  "title_text" = 'GIẤY BÁO NỢ'
WHERE
  "document_type" = 'DEBIT_NOTE'
  AND "deleted_at" IS NULL
  AND (
    "columns" @> '[{"variable":"rowIndex"}]'::jsonb
    OR "columns" @> '[{"variable":"truckPlate"}]'::jsonb
    OR "columns" @> '[{"variable":"actionType"}]'::jsonb
    OR "columns" @> '[{"id":"bien_so"}]'::jsonb
    OR "columns" @> '[{"id":"gia_vc"}]'::jsonb
  );
