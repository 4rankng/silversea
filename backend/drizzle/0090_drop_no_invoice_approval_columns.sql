-- Remove the no-invoice approval-workflow columns from forwarder expense
-- types: finance-lead/director approval limits and titles plus the policy
-- version counter. Tiered no-invoice approval is gone; per-item/per-day
-- limits and evidence policy remain.
ALTER TABLE "forwarder_expense_types" DROP COLUMN "no_invoice_finance_lead_item_approval_limit";--> statement-breakpoint
ALTER TABLE "forwarder_expense_types" DROP COLUMN "no_invoice_director_day_approval_limit";--> statement-breakpoint
ALTER TABLE "forwarder_expense_types" DROP COLUMN "no_invoice_finance_lead_approval_title";--> statement-breakpoint
ALTER TABLE "forwarder_expense_types" DROP COLUMN "no_invoice_director_approval_title";--> statement-breakpoint
ALTER TABLE "forwarder_expense_types" DROP COLUMN "no_invoice_policy_version";