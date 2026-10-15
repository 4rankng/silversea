-- Driver timesheet (chấm công lái xe) — the symbol grid Điều vận fills and
-- Kế toán reconciles (accountant doc §6 "Bảng chấm công", owner ruling
-- 2026-10-14). Hand-written migration: the drizzle-kit snapshot chain in
-- drizzle/meta has a pre-existing parent-snapshot collision, and the
-- per-container declaration migration (20261013210105) set the precedent of
-- an explicit SQL file plus a journal entry.
--
-- Deliberately separate from driver_work_days/attendance: that surface counts
-- one TRIP_DAY per day and carries its own salary-confirmation governance.
-- Neither table writes the other. The symbol vocabulary, the Sunday rule and
-- both salary modes live in shared `computeTimesheetSalary`, so no stored money
-- can drift from the calculation authority.
CREATE TABLE "driver_timesheet_months" (
	"id" serial PRIMARY KEY NOT NULL,
	"driver_id" integer NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"salary_mode" varchar(20) DEFAULT 'PER_TRIP' NOT NULL,
	"daily_base" numeric(15, 0),
	"flat_amount" numeric(15, 0),
	"status" varchar(20) DEFAULT 'OPEN' NOT NULL,
	"reconciled_by" integer,
	"reconciled_at" timestamp with time zone,
	"reconcile_note" text,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "driver_timesheet_months_salary_mode_check" CHECK ("salary_mode" in ('PER_TRIP', 'FLAT_MONTHLY')),
	CONSTRAINT "driver_timesheet_months_status_check" CHECK ("status" in ('OPEN', 'RECONCILED')),
	CONSTRAINT "driver_timesheet_months_period_check" CHECK ("month" between 1 and 12)
);
--> statement-breakpoint
CREATE TABLE "driver_timesheet_days" (
	"id" serial PRIMARY KEY NOT NULL,
	"month_id" integer NOT NULL,
	"driver_id" integer NOT NULL,
	"work_date" date NOT NULL,
	"symbol" varchar(1) NOT NULL,
	"is_sunday" boolean DEFAULT false NOT NULL,
	"trip_adjustment" integer DEFAULT 0 NOT NULL,
	"adjusted_by" integer,
	"adjusted_at" timestamp with time zone,
	"note" text,
	"entered_by" integer,
	"entered_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "driver_timesheet_days_symbol_check" CHECK ("symbol" in ('K', 'Q', 'Đ', 'L', 'N', 'P'))
);
--> statement-breakpoint
ALTER TABLE "driver_timesheet_days" ADD CONSTRAINT "driver_timesheet_days_month_id_month_id_fk" FOREIGN KEY ("month_id") REFERENCES "driver_timesheet_months"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE UNIQUE INDEX "driver_timesheet_months_driver_period_unq" ON "driver_timesheet_months" USING btree ("driver_id","year","month");--> statement-breakpoint
CREATE INDEX "driver_timesheet_months_period_idx" ON "driver_timesheet_months" USING btree ("year","month");--> statement-breakpoint
CREATE INDEX "driver_timesheet_months_status_idx" ON "driver_timesheet_months" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "driver_timesheet_days_month_date_unq" ON "driver_timesheet_days" USING btree ("month_id","work_date");--> statement-breakpoint
CREATE INDEX "driver_timesheet_days_driver_date_idx" ON "driver_timesheet_days" USING btree ("driver_id","work_date");