-- Expense dual-control review (payable-side segregation of duties).
-- Submission now parks expenses as PENDING; a checker and a different
-- approver must complete review before the supplier debt posts. Legacy
-- rows are backfilled APPROVED — they were posted under the old
-- auto-apply flow and their ledger entries already exist.
ALTER TABLE "expenses" ADD COLUMN "approval_status" varchar(20) NOT NULL DEFAULT 'APPROVED';
ALTER TABLE "expenses" ADD COLUMN "checked_by" integer;
ALTER TABLE "expenses" ADD COLUMN "checked_at" timestamp;
ALTER TABLE "expenses" ADD COLUMN "approved_by" integer;
ALTER TABLE "expenses" ADD COLUMN "approved_at" timestamp;
ALTER TABLE "expenses" ADD COLUMN "rejection_reason" text;
