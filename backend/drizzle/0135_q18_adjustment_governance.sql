CREATE TABLE "governance_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"subject_type" varchar(30) NOT NULL,
	"subject_id" integer NOT NULL,
	"action_kind" varchar(40) NOT NULL,
	"status" varchar(30) DEFAULT 'PENDING_CHECK' NOT NULL,
	"reason" text NOT NULL,
	"original_version" integer NOT NULL,
	"original_period_lock_id" integer,
	"before_snapshot" jsonb NOT NULL,
	"after_snapshot" jsonb NOT NULL,
	"delta_snapshot" jsonb,
	"maker_id" integer NOT NULL,
	"checker_id" integer,
	"checked_at" timestamp with time zone,
	"approver_id" integer,
	"approved_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"ledger_entry_id" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "governance_actions_subject_type_check" CHECK ("governance_actions"."subject_type" in ('TRIP')),
	CONSTRAINT "governance_actions_action_kind_check" CHECK ("governance_actions"."action_kind" in ('TRIP_AR_ADJUSTMENT', 'TRIP_REOPEN')),
	CONSTRAINT "governance_actions_status_check" CHECK ("governance_actions"."status" in ('PENDING_CHECK', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED')),
	CONSTRAINT "governance_actions_reason_check" CHECK (length(btrim("governance_actions"."reason")) > 0)
);
--> statement-breakpoint
ALTER TABLE "trip_expenses" ADD COLUMN "created_by" integer;--> statement-breakpoint
UPDATE "trip_expenses"
SET "created_by" = "forwarder_id"
WHERE "forwarder_id" IS NOT NULL
  AND "created_by" IS NULL;--> statement-breakpoint
ALTER TABLE "governance_actions" ADD CONSTRAINT "governance_actions_original_period_lock_id_period_locks_id_fk" FOREIGN KEY ("original_period_lock_id") REFERENCES "public"."period_locks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "governance_actions" ADD CONSTRAINT "governance_actions_maker_id_users_id_fk" FOREIGN KEY ("maker_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "governance_actions" ADD CONSTRAINT "governance_actions_checker_id_users_id_fk" FOREIGN KEY ("checker_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "governance_actions" ADD CONSTRAINT "governance_actions_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "governance_actions" ADD CONSTRAINT "governance_actions_ledger_entry_id_ledger_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."ledger"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "governance_actions_subject_idx" ON "governance_actions" USING btree ("subject_type","subject_id","created_at");--> statement-breakpoint
CREATE INDEX "governance_actions_status_idx" ON "governance_actions" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
