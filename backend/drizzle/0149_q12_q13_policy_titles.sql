ALTER TABLE "forwarder_expense_types"
  ADD COLUMN "no_invoice_finance_lead_approval_title" varchar(50) DEFAULT 'FINANCE_LEAD' NOT NULL;
--> statement-breakpoint
ALTER TABLE "forwarder_expense_types"
  ADD COLUMN "no_invoice_director_approval_title" varchar(50) DEFAULT 'DIRECTOR' NOT NULL;
