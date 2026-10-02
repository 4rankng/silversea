-- Card 20260922_78 batch 2 (Q10): OpsWallet deletes become governed soft
-- voids — add the reason/actor trail to ops_expense_entries (deleted rows
-- keep approvalStatus='VOIDED'; the timestamp rides updatedAt + the trail
-- columns added here).
ALTER TABLE "ops_expense_entries" ADD COLUMN "deletion_reason" text;--> statement-breakpoint
ALTER TABLE "ops_expense_entries" ADD COLUMN "deleted_by" integer;