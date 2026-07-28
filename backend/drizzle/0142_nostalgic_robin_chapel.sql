CREATE TABLE "salary_period_adjustments" (
	"id" serial PRIMARY KEY NOT NULL,
	"governance_action_id" integer NOT NULL,
	"source_period" varchar(7) NOT NULL,
	"target_period" varchar(7) NOT NULL,
	"driver_id" integer NOT NULL,
	"amount" numeric(15, 0) NOT NULL,
	"reason" text NOT NULL,
	"approved_by" integer NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "salary_period_adjustments_amount_check" CHECK ("salary_period_adjustments"."amount" <> 0),
	CONSTRAINT "salary_period_adjustments_reason_check" CHECK (length(btrim("salary_period_adjustments"."reason")) > 0),
	CONSTRAINT "salary_period_adjustments_source_target_check" CHECK ("salary_period_adjustments"."source_period" <> "salary_period_adjustments"."target_period")
);
--> statement-breakpoint
ALTER TABLE "governance_actions" DROP CONSTRAINT "governance_actions_action_kind_check";--> statement-breakpoint
ALTER TABLE "salary_period_closes" ADD COLUMN "payslip_issued_by" integer;--> statement-breakpoint
ALTER TABLE "salary_period_closes" ADD COLUMN "payslip_issued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "salary_period_closes" ADD COLUMN "payslip_issued_note" text;--> statement-breakpoint
ALTER TABLE "salary_period_closes" ADD COLUMN "official_posted_by" integer;--> statement-breakpoint
ALTER TABLE "salary_period_closes" ADD COLUMN "official_posted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "salary_period_closes" ADD COLUMN "official_posting_note" text;--> statement-breakpoint
ALTER TABLE "salary_period_closes" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "salary_period_adjustments" ADD CONSTRAINT "salary_period_adjustments_governance_action_id_governance_actions_id_fk" FOREIGN KEY ("governance_action_id") REFERENCES "public"."governance_actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_period_adjustments" ADD CONSTRAINT "salary_period_adjustments_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_period_adjustments" ADD CONSTRAINT "salary_period_adjustments_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "salary_period_adjustments_action_uniq" ON "salary_period_adjustments" USING btree ("governance_action_id");--> statement-breakpoint
CREATE INDEX "salary_period_adjustments_target_driver_idx" ON "salary_period_adjustments" USING btree ("target_period","driver_id","created_at");--> statement-breakpoint
CREATE INDEX "salary_period_adjustments_source_driver_idx" ON "salary_period_adjustments" USING btree ("source_period","driver_id","created_at");--> statement-breakpoint
ALTER TABLE "salary_period_closes" ADD CONSTRAINT "salary_period_closes_payslip_issued_by_users_id_fk" FOREIGN KEY ("payslip_issued_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_period_closes" ADD CONSTRAINT "salary_period_closes_official_posted_by_users_id_fk" FOREIGN KEY ("official_posted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "governance_actions" ADD CONSTRAINT "governance_actions_action_kind_check" CHECK ("governance_actions"."action_kind" in ('TRIP_AR_ADJUSTMENT', 'TRIP_REOPEN', 'TRIP_EXPENSE_APPROVAL', 'DEBT_OFFSET_APPROVAL', 'DEBT_OFFSET_CANCEL', 'ADVANCE_REQUEST_APPROVAL', 'PAYMENT_RECEIPT', 'VENDOR_PAYMENT', 'CARRIER_PAYMENT', 'DRIVER_PAYOUT', 'COMMISSION', 'PENALTY_CREATE', 'PENALTY_CANCEL', 'COMPANY_EXPENSE', 'PROFIT_DISTRIBUTION', 'TRIP_FINANCIAL_CHANGE', 'TRIP_FINANCIAL_CLOSE', 'DEBIT_NOTE_ISSUE', 'DEBIT_NOTE_ADJUSTMENT', 'SALARY_CONFIRMATION', 'SALARY_REOPEN', 'SALARY_PERIOD_CLOSE', 'SALARY_PERIOD_REOPEN', 'SALARY_PERIOD_ADJUSTMENT', 'PRICE_CONFIG_CHANGE', 'ANCILLARY_REVENUE_CHANGE', 'FINANCIAL_EXCEPTION'));--> statement-breakpoint
ALTER TABLE "salary_period_closes" ADD CONSTRAINT "salary_period_closes_version_check" CHECK ("salary_period_closes"."version" >= 1);