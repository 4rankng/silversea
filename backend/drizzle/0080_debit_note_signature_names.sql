
ALTER TABLE "debit_note_templates"
  ADD COLUMN IF NOT EXISTS "signature_left_name" varchar(100),
  ADD COLUMN IF NOT EXISTS "signature_right_name" varchar(100);--> statement-breakpoint
