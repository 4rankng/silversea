ALTER TABLE "salary_period_closes" ADD COLUMN "payroll_scope" varchar(20) DEFAULT 'COMPANY' NOT NULL;--> statement-breakpoint
ALTER TABLE "salary_period_closes" ADD COLUMN "payroll_business_unit_id" integer;--> statement-breakpoint
ALTER TABLE "salary_period_closes" ADD COLUMN "payroll_business_unit_name" text;--> statement-breakpoint
ALTER TABLE "salary_period_closes" ADD COLUMN "included_driver_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "salary_period_closes" ADD COLUMN "excluded_driver_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "salary_period_closes" ADD CONSTRAINT "salary_period_closes_payroll_scope_check" CHECK ("salary_period_closes"."payroll_scope" in ('COMPANY', 'BUSINESS_UNIT'));