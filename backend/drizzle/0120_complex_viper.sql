ALTER TABLE "expense_categories" ADD COLUMN "requires_invoice" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "forwarder_expense_types" ADD COLUMN "requires_invoice" boolean DEFAULT false;