
-- Treat "Số chứng từ" as the expense document code, not the trip code. This
-- keeps existing custom debit-note templates but updates the standard
-- chung_tu column binding so future saved snapshots use render_data.documentCode
-- (invoice_number first, then declaration_number).
UPDATE "debit_note_templates"
SET "columns" = (
  SELECT jsonb_agg(
    CASE
      WHEN col.elem->>'id' = 'chung_tu' AND col.elem->>'variable' = 'tripCode'
        THEN jsonb_set(col.elem, '{variable}', '"documentCode"'::jsonb, false)
      ELSE col.elem
    END
    ORDER BY col.ord
  )
  FROM jsonb_array_elements("columns") WITH ORDINALITY AS col(elem, ord)
)
WHERE
  "document_type" = 'DEBIT_NOTE'
  AND "deleted_at" IS NULL
  AND "columns" @> '[{"id":"chung_tu","variable":"tripCode"}]'::jsonb;
