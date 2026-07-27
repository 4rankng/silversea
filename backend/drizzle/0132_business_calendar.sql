CREATE TABLE "business_calendar_days" (
	"id" serial PRIMARY KEY NOT NULL,
	"calendar_date" date NOT NULL,
	"name" varchar(255) NOT NULL,
	"is_working_day" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "payment_date_policy" varchar(30) DEFAULT 'NEXT_BUSINESS_DAY' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "business_calendar_days_date_uniq_idx" ON "business_calendar_days" USING btree ("calendar_date");