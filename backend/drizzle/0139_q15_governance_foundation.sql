ALTER TABLE "governance_actions" DROP CONSTRAINT "governance_actions_subject_type_check";--> statement-breakpoint
ALTER TABLE "governance_actions" DROP CONSTRAINT "governance_actions_action_kind_check";--> statement-breakpoint
ALTER TABLE "governance_actions" DROP CONSTRAINT "governance_actions_status_check";--> statement-breakpoint
ALTER TABLE "governance_actions" ALTER COLUMN "subject_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "governance_actions" ADD COLUMN "subject_key" varchar(120);--> statement-breakpoint
ALTER TABLE "governance_actions" ADD COLUMN "maker_role" varchar(20);--> statement-breakpoint
ALTER TABLE "governance_actions" ADD COLUMN "checker_role" varchar(20);--> statement-breakpoint
ALTER TABLE "governance_actions" ADD COLUMN "approver_role" varchar(20);--> statement-breakpoint
ALTER TABLE "governance_actions" ADD COLUMN "rejected_by" integer;--> statement-breakpoint
ALTER TABLE "governance_actions" ADD COLUMN "rejected_role" varchar(20);--> statement-breakpoint
ALTER TABLE "governance_actions" ADD COLUMN "rejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "governance_actions" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "governance_actions" ADD COLUMN "returned_by" integer;--> statement-breakpoint
ALTER TABLE "governance_actions" ADD COLUMN "returned_role" varchar(20);--> statement-breakpoint
ALTER TABLE "governance_actions" ADD COLUMN "returned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "governance_actions" ADD COLUMN "return_reason" text;--> statement-breakpoint
ALTER TABLE "governance_actions" ADD COLUMN "canceled_by" integer;--> statement-breakpoint
ALTER TABLE "governance_actions" ADD COLUMN "canceled_role" varchar(20);--> statement-breakpoint
ALTER TABLE "governance_actions" ADD COLUMN "canceled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "governance_actions" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "governance_actions" ADD COLUMN "application_result" jsonb;--> statement-breakpoint
ALTER TABLE "governance_actions" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "governance_actions" ADD CONSTRAINT "governance_actions_rejected_by_users_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "governance_actions" ADD CONSTRAINT "governance_actions_returned_by_users_id_fk" FOREIGN KEY ("returned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "governance_actions" ADD CONSTRAINT "governance_actions_canceled_by_users_id_fk" FOREIGN KEY ("canceled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "governance_actions_subject_key_idx" ON "governance_actions" USING btree ("subject_type","subject_key","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "governance_actions_active_subject_key_uniq" ON "governance_actions" USING btree ("subject_type","subject_key","action_kind","original_version") WHERE "governance_actions"."subject_key" is not null and "governance_actions"."status" in ('PENDING_CHECK', 'PENDING_APPROVAL', 'RETURNED_FOR_EVIDENCE');--> statement-breakpoint
CREATE UNIQUE INDEX "governance_actions_active_subject_id_uniq" ON "governance_actions" USING btree ("subject_type","subject_id","action_kind","original_version") WHERE "governance_actions"."subject_id" is not null and "governance_actions"."action_kind" not in ('TRIP_AR_ADJUSTMENT', 'TRIP_REOPEN') and "governance_actions"."status" in ('PENDING_CHECK', 'PENDING_APPROVAL', 'RETURNED_FOR_EVIDENCE');--> statement-breakpoint
ALTER TABLE "governance_actions" ADD CONSTRAINT "governance_actions_subject_identity_check" CHECK ("governance_actions"."subject_id" is not null or length(btrim("governance_actions"."subject_key")) > 0);--> statement-breakpoint
ALTER TABLE "governance_actions" ADD CONSTRAINT "governance_actions_original_version_check" CHECK ("governance_actions"."original_version" >= 0);--> statement-breakpoint
ALTER TABLE "governance_actions" ADD CONSTRAINT "governance_actions_distinct_checker_check" CHECK ("governance_actions"."checker_id" is null or "governance_actions"."checker_id" <> "governance_actions"."maker_id");--> statement-breakpoint
ALTER TABLE "governance_actions" ADD CONSTRAINT "governance_actions_distinct_approver_check" CHECK ("governance_actions"."approver_id" is null or ("governance_actions"."approver_id" <> "governance_actions"."maker_id" and ("governance_actions"."checker_id" is null or "governance_actions"."approver_id" <> "governance_actions"."checker_id")));--> statement-breakpoint
ALTER TABLE "governance_actions" ADD CONSTRAINT "governance_actions_distinct_rejector_check" CHECK ("governance_actions"."rejected_by" is null or "governance_actions"."rejected_by" <> "governance_actions"."maker_id");--> statement-breakpoint
ALTER TABLE "governance_actions" ADD CONSTRAINT "governance_actions_distinct_returner_check" CHECK ("governance_actions"."returned_by" is null or "governance_actions"."returned_by" <> "governance_actions"."maker_id");--> statement-breakpoint
ALTER TABLE "governance_actions" ADD CONSTRAINT "governance_actions_cancel_actor_check" CHECK ("governance_actions"."canceled_by" is null or "governance_actions"."canceled_by" = "governance_actions"."maker_id");--> statement-breakpoint
ALTER TABLE "governance_actions" ADD CONSTRAINT "governance_actions_rejection_reason_check" CHECK ("governance_actions"."rejection_reason" is null or length(btrim("governance_actions"."rejection_reason")) > 0);--> statement-breakpoint
ALTER TABLE "governance_actions" ADD CONSTRAINT "governance_actions_return_reason_check" CHECK ("governance_actions"."return_reason" is null or length(btrim("governance_actions"."return_reason")) > 0);--> statement-breakpoint
ALTER TABLE "governance_actions" ADD CONSTRAINT "governance_actions_cancel_reason_check" CHECK ("governance_actions"."cancel_reason" is null or length(btrim("governance_actions"."cancel_reason")) > 0);--> statement-breakpoint
ALTER TABLE "governance_actions" ADD CONSTRAINT "governance_actions_subject_type_check" CHECK ("governance_actions"."subject_type" in ('TRIP', 'PAYMENT_RECEIPT', 'VENDOR_PAYMENT', 'CARRIER_PAYMENT', 'DRIVER_PAYOUT', 'COMMISSION', 'PENALTY', 'DEBT_OFFSET', 'ADVANCE_REQUEST', 'TRIP_EXPENSE', 'COMPANY_EXPENSE', 'BILLING_DOCUMENT', 'SALARY_CONFIRMATION', 'SALARY_PERIOD', 'PROFIT_DISTRIBUTION', 'PRICE_CONFIG', 'ANCILLARY_REVENUE', 'EXCEPTION'));--> statement-breakpoint
ALTER TABLE "governance_actions" ADD CONSTRAINT "governance_actions_action_kind_check" CHECK ("governance_actions"."action_kind" in ('TRIP_AR_ADJUSTMENT', 'TRIP_REOPEN', 'TRIP_EXPENSE_APPROVAL', 'DEBT_OFFSET_APPROVAL', 'DEBT_OFFSET_CANCEL', 'ADVANCE_REQUEST_APPROVAL', 'PAYMENT_RECEIPT', 'VENDOR_PAYMENT', 'CARRIER_PAYMENT', 'DRIVER_PAYOUT', 'COMMISSION', 'PENALTY_CREATE', 'PENALTY_CANCEL', 'COMPANY_EXPENSE', 'PROFIT_DISTRIBUTION', 'TRIP_FINANCIAL_CHANGE', 'TRIP_FINANCIAL_CLOSE', 'DEBIT_NOTE_ISSUE', 'DEBIT_NOTE_ADJUSTMENT', 'SALARY_CONFIRMATION', 'SALARY_REOPEN', 'SALARY_PERIOD_CLOSE', 'SALARY_PERIOD_REOPEN', 'PRICE_CONFIG_CHANGE', 'ANCILLARY_REVENUE_CHANGE', 'FINANCIAL_EXCEPTION'));--> statement-breakpoint
ALTER TABLE "governance_actions" ADD CONSTRAINT "governance_actions_status_check" CHECK ("governance_actions"."status" in ('PENDING_CHECK', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'RETURNED_FOR_EVIDENCE', 'CANCELED', 'SUPERSEDED'));
