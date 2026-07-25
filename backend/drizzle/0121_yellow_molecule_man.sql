CREATE TABLE "payment_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"receipt_id" integer,
	"customer_id" integer NOT NULL,
	"target_type" varchar(20) NOT NULL,
	"target_id" integer NOT NULL,
	"amount" numeric(15, 0) NOT NULL,
	"allocation_method" varchar(20) DEFAULT 'OLDEST_FIRST' NOT NULL,
	"allocated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salary_period_closes" (
	"id" serial PRIMARY KEY NOT NULL,
	"period" varchar(7) NOT NULL,
	"status" varchar(20) DEFAULT 'CLOSED' NOT NULL,
	"ledger_entry_id" integer,
	"closed_by" integer,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "credit_warning_threshold" numeric(3, 2);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "payment_term_days" integer;--> statement-breakpoint
ALTER TABLE "expense_categories" ADD COLUMN "substitute_evidence_allowed" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_allocated_by_users_id_fk" FOREIGN KEY ("allocated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_period_closes" ADD CONSTRAINT "salary_period_closes_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_allocations_customer_idx" ON "payment_allocations" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "payment_allocations_target_idx" ON "payment_allocations" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "payment_allocations_receipt_idx" ON "payment_allocations" USING btree ("receipt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "salary_period_closes_period_uniq" ON "salary_period_closes" USING btree ("period");