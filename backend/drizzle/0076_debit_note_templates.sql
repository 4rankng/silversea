
-- Debit-note (Giấy báo nợ) templates. Form-driven, Excel-only layout presets
-- that users build in the Cấu hình page and pick per customer at export time.
-- Single default is enforced in code (transactional upsert in the route), NOT by
-- a partial unique index — mirrors the salary_periods.isDefault precedent
-- (in-code enforcement avoids the non-atomic clear-then-set race that
-- crud-factory would introduce, and avoids surfacing a confusing 409).
--
-- `document_type` is reserved for forward-compat (PAYMENT_STATEMENT templating);
-- the resolver guards to DEBIT_NOTE today so vendor exports never inherit AR
-- styling. `amount_in_words` is Phase 2 (rendered read-only in UI; reserved for
-- a future vndToWords() helper) — no helper exists yet.

CREATE TABLE IF NOT EXISTS "debit_note_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"is_default" boolean NOT NULL DEFAULT false,
	"document_type" varchar(20) NOT NULL DEFAULT 'DEBIT_NOTE',
	"logo_storage_key" varchar(500),
	"title_text" varchar(100) NOT NULL DEFAULT 'GIẤY BÁO NỢ',
	"issuer_name" varchar(200),
	"issuer_address" varchar(300),
	"issuer_tax_code" varchar(50),
	"accent_color" varchar(20) NOT NULL DEFAULT '#1F4E79',
	"show_container_column" boolean NOT NULL DEFAULT true,
	"show_unit_column" boolean NOT NULL DEFAULT true,
	"grouping_mode" varchar(20) NOT NULL DEFAULT 'ROUTE',
	"amount_in_words" boolean NOT NULL DEFAULT false,
	"orientation" varchar(10) NOT NULL DEFAULT 'landscape',
	"terms_text" text,
	"signature_left_label" varchar(100) DEFAULT 'Khách hàng',
	"signature_right_label" varchar(100) DEFAULT 'Kế toán trưởng',
	"created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);--> statement-breakpoint

-- Per-customer override (null = use the global default template).
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "debit_note_template_id" integer REFERENCES "debit_note_templates"("id") ON DELETE SET NULL;--> statement-breakpoint

-- Live link + frozen render-only snapshot on each billing document. The snapshot
-- (jsonb) holds the template fields used to render THIS doc, so a historical
-- debit note re-exports identically even after the template (or its logo) is
-- edited or deleted. Consistent with billing_documents already being a snapshot
-- system (totalInclVat, entityName, line overrides are all frozen at save).
ALTER TABLE "billing_documents" ADD COLUMN IF NOT EXISTS "debit_note_template_id" integer REFERENCES "debit_note_templates"("id") ON DELETE SET NULL;--> statement-breakpoint

ALTER TABLE "billing_documents" ADD COLUMN IF NOT EXISTS "debit_note_template_snapshot" jsonb;--> statement-breakpoint
