
-- Seed the default debit-note template. Field values mirror the legacy
-- hardcoded xlsx layout (buildLegacyXlsx) so existing exports look unchanged.
-- Idempotent: only inserts when NO active default exists, so re-runs never
-- duplicate and never override a default a user has deliberately set.
INSERT INTO debit_note_templates (
	"name", "is_default", "document_type", "title_text", "accent_color",
	"show_container_column", "show_unit_column", "grouping_mode", "orientation",
	"signature_left_label", "signature_right_label"
)
SELECT
	'Mặc định', true, 'DEBIT_NOTE', 'GIẤY BÁO NỢ', '#1F4E79',
	true, true, 'ROUTE', 'landscape', 'Khách hàng', 'Kế toán trưởng'
WHERE NOT EXISTS (
	SELECT 1 FROM "debit_note_templates" WHERE "is_default" = true AND "deleted_at" IS NULL
);
