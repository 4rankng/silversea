ALTER TABLE "salary_period_closes" DROP CONSTRAINT "salary_period_closes_payroll_scope_check";--> statement-breakpoint
ALTER TABLE "salary_period_closes" ALTER COLUMN "payroll_scope" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "salary_period_closes" ALTER COLUMN "payroll_scope" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "salary_period_closes" ALTER COLUMN "included_driver_ids" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "salary_period_closes" ALTER COLUMN "included_driver_ids" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "salary_period_closes" ALTER COLUMN "excluded_driver_ids" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "salary_period_closes" ALTER COLUMN "excluded_driver_ids" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "salary_period_closes" ADD COLUMN "payroll_provenance_captured_at" timestamp with time zone;--> statement-breakpoint
UPDATE "salary_period_closes"
SET "payroll_scope" = NULL,
    "payroll_business_unit_id" = NULL,
    "payroll_business_unit_name" = NULL,
    "included_driver_ids" = NULL,
    "excluded_driver_ids" = NULL
WHERE "payroll_provenance_captured_at" IS NULL;--> statement-breakpoint
ALTER TABLE "salary_period_closes" ADD CONSTRAINT "salary_period_closes_payroll_scope_check" CHECK ("salary_period_closes"."payroll_scope" is null or "salary_period_closes"."payroll_scope" in ('COMPANY', 'BUSINESS_UNIT'));
