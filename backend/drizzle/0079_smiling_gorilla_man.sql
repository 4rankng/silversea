ALTER TABLE "billing_document_lines" ADD COLUMN "render_data" jsonb;--> statement-breakpoint
ALTER TABLE "debit_note_templates" ADD COLUMN "columns" jsonb DEFAULT '[]'::jsonb NOT NULL;