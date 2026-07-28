CREATE TABLE "payment_refunds" (
	"id" serial PRIMARY KEY NOT NULL,
	"payment_receipt_id" integer NOT NULL,
	"governance_action_id" integer NOT NULL,
	"amount" numeric(15, 0) NOT NULL,
	"reason" text NOT NULL,
	"created_by" integer NOT NULL,
	"approved_by" integer NOT NULL,
	"ledger_entry_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_refunds_amount_positive_check" CHECK ("payment_refunds"."amount" > 0),
	CONSTRAINT "payment_refunds_reason_check" CHECK (length(btrim("payment_refunds"."reason")) > 0),
	CONSTRAINT "payment_refunds_distinct_actors_check" CHECK ("payment_refunds"."created_by" <> "payment_refunds"."approved_by")
);
--> statement-breakpoint
ALTER TABLE "governance_actions" DROP CONSTRAINT "governance_actions_subject_type_check";--> statement-breakpoint
ALTER TABLE "governance_actions" DROP CONSTRAINT "governance_actions_action_kind_check";--> statement-breakpoint
ALTER TABLE "payment_receipts" DROP CONSTRAINT "payment_receipts_amount_consistency_check";--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD COLUMN "refunded_amount" numeric(15, 0) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_payment_receipt_id_payment_receipts_id_fk" FOREIGN KEY ("payment_receipt_id") REFERENCES "public"."payment_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_governance_action_id_governance_actions_id_fk" FOREIGN KEY ("governance_action_id") REFERENCES "public"."governance_actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_ledger_entry_id_ledger_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."ledger"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_refunds_governance_action_uniq" ON "payment_refunds" USING btree ("governance_action_id");--> statement-breakpoint
CREATE INDEX "payment_refunds_receipt_created_idx" ON "payment_refunds" USING btree ("payment_receipt_id","created_at");--> statement-breakpoint
ALTER TABLE "governance_actions" ADD CONSTRAINT "governance_actions_subject_type_check" CHECK ("governance_actions"."subject_type" in ('TRIP', 'PAYMENT_RECEIPT', 'PAYMENT_REFUND', 'VENDOR_PAYMENT', 'CARRIER_PAYMENT', 'DRIVER_PAYOUT', 'COMMISSION', 'PENALTY', 'DEBT_OFFSET', 'ADVANCE_REQUEST', 'TRIP_EXPENSE', 'COMPANY_EXPENSE', 'BILLING_DOCUMENT', 'SALARY_CONFIRMATION', 'SALARY_PERIOD', 'PROFIT_DISTRIBUTION', 'PRICE_CONFIG', 'ANCILLARY_REVENUE', 'EXCEPTION'));--> statement-breakpoint
ALTER TABLE "governance_actions" ADD CONSTRAINT "governance_actions_action_kind_check" CHECK ("governance_actions"."action_kind" in ('TRIP_AR_ADJUSTMENT', 'TRIP_REOPEN', 'TRIP_EXPENSE_APPROVAL', 'DEBT_OFFSET_APPROVAL', 'DEBT_OFFSET_CANCEL', 'ADVANCE_REQUEST_APPROVAL', 'PAYMENT_RECEIPT', 'PAYMENT_REFUND', 'VENDOR_PAYMENT', 'CARRIER_PAYMENT', 'DRIVER_PAYOUT', 'COMMISSION', 'PENALTY_CREATE', 'PENALTY_CANCEL', 'COMPANY_EXPENSE', 'PROFIT_DISTRIBUTION', 'TRIP_FINANCIAL_CHANGE', 'TRIP_FINANCIAL_CLOSE', 'DEBIT_NOTE_ISSUE', 'DEBIT_NOTE_ADJUSTMENT', 'SALARY_CONFIRMATION', 'SALARY_REOPEN', 'SALARY_PERIOD_CLOSE', 'SALARY_PERIOD_REOPEN', 'SALARY_PERIOD_ADJUSTMENT', 'PRICE_CONFIG_CHANGE', 'ANCILLARY_REVENUE_CHANGE', 'FINANCIAL_EXCEPTION'));--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_refunded_amount_nonneg_check" CHECK ("payment_receipts"."refunded_amount" >= 0);--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_version_check" CHECK ("payment_receipts"."version" >= 1);--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_amount_consistency_check" CHECK ("payment_receipts"."received_amount" = "payment_receipts"."allocated_total" + "payment_receipts"."unapplied_amount" + "payment_receipts"."refunded_amount");