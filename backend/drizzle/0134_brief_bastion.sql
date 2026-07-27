CREATE TABLE "billing_document_source_period_locks" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"period_lock_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "period_locks" (
	"id" serial PRIMARY KEY NOT NULL,
	"domain" varchar(30) NOT NULL,
	"scope_type" varchar(20) DEFAULT 'GLOBAL' NOT NULL,
	"scope_id" integer DEFAULT 0 NOT NULL,
	"cycle" varchar(20) NOT NULL,
	"period_key" varchar(40) NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" varchar(20) DEFAULT 'CLOSED' NOT NULL,
	"closed_by" integer,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reopened_by" integer,
	"reopened_at" timestamp with time zone,
	"note" text,
	"reopen_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "period_locks_domain_check" CHECK ("period_locks"."domain" in ('SALARY', 'FUEL', 'DEBIT_NOTE')),
	CONSTRAINT "period_locks_scope_type_check" CHECK ("period_locks"."scope_type" in ('GLOBAL', 'CUSTOMER')),
	CONSTRAINT "period_locks_cycle_check" CHECK ("period_locks"."cycle" in ('MONTHLY', 'WEEKLY')),
	CONSTRAINT "period_locks_status_check" CHECK ("period_locks"."status" in ('CLOSED', 'REOPENED')),
	CONSTRAINT "period_locks_scope_global_id_check" CHECK (("period_locks"."scope_type" <> 'GLOBAL') or ("period_locks"."scope_id" = 0))
);
--> statement-breakpoint
ALTER TABLE "billing_document_source_period_locks" ADD CONSTRAINT "billing_document_source_period_locks_document_id_billing_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."billing_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_document_source_period_locks" ADD CONSTRAINT "billing_document_source_period_locks_period_lock_id_period_locks_id_fk" FOREIGN KEY ("period_lock_id") REFERENCES "public"."period_locks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_locks" ADD CONSTRAINT "period_locks_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_locks" ADD CONSTRAINT "period_locks_reopened_by_users_id_fk" FOREIGN KEY ("reopened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_document_source_period_locks_doc_period_uniq" ON "billing_document_source_period_locks" USING btree ("document_id","period_lock_id");--> statement-breakpoint
CREATE INDEX "billing_document_source_period_locks_period_idx" ON "billing_document_source_period_locks" USING btree ("period_lock_id");--> statement-breakpoint
CREATE UNIQUE INDEX "period_locks_domain_scope_period_uniq" ON "period_locks" USING btree ("domain","scope_type","scope_id","period_key");--> statement-breakpoint
CREATE INDEX "period_locks_lookup_idx" ON "period_locks" USING btree ("domain","scope_type","scope_id","status","period_start","period_end");