CREATE TABLE "billing_document_disputes" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"document_version" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"disputed_by" integer NOT NULL,
	"reason" text NOT NULL,
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"idempotency_key" varchar(100) NOT NULL,
	"disputed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_document_disputes_version_check" CHECK ("billing_document_disputes"."document_version" > 0),
	CONSTRAINT "billing_document_disputes_reason_check" CHECK (length(btrim("billing_document_disputes"."reason")) > 0)
);
--> statement-breakpoint
CREATE TABLE "billing_document_recoverable_claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"expense_id" integer NOT NULL,
	"expense_version" integer NOT NULL,
	"source_version" varchar(120) NOT NULL,
	"evidence_snapshot" jsonb NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_document_recoverable_claims_version_check" CHECK ("billing_document_recoverable_claims"."expense_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "customer_event_acknowledgements" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"event_version" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"acknowledged_by" integer NOT NULL,
	"kind" varchar(20) DEFAULT 'ACKNOWLEDGED' NOT NULL,
	"idempotency_key" varchar(100) NOT NULL,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_event_ack_version_check" CHECK ("customer_event_acknowledgements"."event_version" > 0),
	CONSTRAINT "customer_event_ack_kind_check" CHECK ("customer_event_acknowledgements"."kind" in ('SEEN', 'ACKNOWLEDGED'))
);
--> statement-breakpoint
CREATE TABLE "customer_visible_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"shipment_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"milestone_id" integer,
	"event_key" varchar(120) NOT NULL,
	"content_version" integer NOT NULL,
	"event_type" varchar(40) NOT NULL,
	"classification" varchar(30) DEFAULT 'CUSTOMER_VISIBLE' NOT NULL,
	"content_snapshot" jsonb NOT NULL,
	"supersedes_event_id" integer,
	"created_by" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_visible_events_version_check" CHECK ("customer_visible_events"."content_version" > 0),
	CONSTRAINT "customer_visible_events_classification_check" CHECK ("customer_visible_events"."classification" = 'CUSTOMER_VISIBLE'),
	CONSTRAINT "customer_visible_events_type_check" CHECK ("customer_visible_events"."event_type" in ('MILESTONE', 'DELIVERY_PLAN', 'DOCUMENT_UPDATE', 'DEBIT_NOTE_CONFIRMATION'))
);
--> statement-breakpoint
CREATE TABLE "profitability_snapshot_dimensions" (
	"id" serial PRIMARY KEY NOT NULL,
	"snapshot_id" integer NOT NULL,
	"dimension" varchar(30) NOT NULL,
	"dimension_key" varchar(120) NOT NULL,
	"dimension_label" varchar(255) NOT NULL,
	"attribution_status" varchar(30) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "profitability_snapshot_dimensions_dimension_check" CHECK ("profitability_snapshot_dimensions"."dimension" in ('CUSTOMER', 'ROUTE', 'TRUCK', 'DISPATCHER', 'SALESPERSON', 'MONTH', 'YEAR', 'CONTAINER')),
	CONSTRAINT "profitability_snapshot_dimensions_status_check" CHECK ("profitability_snapshot_dimensions"."attribution_status" in ('ATTRIBUTED', 'MISSING'))
);
--> statement-breakpoint
CREATE TABLE "profitability_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"financial_posting_id" integer NOT NULL,
	"trip_id" integer NOT NULL,
	"shipment_id" integer,
	"completed_business_date" date NOT NULL,
	"revenue" numeric(15, 0) NOT NULL,
	"direct_cost" numeric(15, 0) NOT NULL,
	"shared_overhead" numeric(15, 0) DEFAULT '0' NOT NULL,
	"profit" numeric(15, 0) NOT NULL,
	"attribution_status" varchar(30) NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profitability_snapshots_attribution_status_check" CHECK ("profitability_snapshots"."attribution_status" in ('COMPLETE', 'MISSING_ATTRIBUTION', 'PARTIAL')),
	CONSTRAINT "profitability_snapshots_amount_check" CHECK ("profitability_snapshots"."profit" = "profitability_snapshots"."revenue" - "profitability_snapshots"."direct_cost" - "profitability_snapshots"."shared_overhead")
);
--> statement-breakpoint
CREATE TABLE "salesperson_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"shipment_id" integer,
	"salesperson_user_id" integer NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"version" integer NOT NULL,
	"supersedes_assignment_id" integer,
	"change_reason" text NOT NULL,
	"changed_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "salesperson_assignments_version_check" CHECK ("salesperson_assignments"."version" > 0),
	CONSTRAINT "salesperson_assignments_reason_check" CHECK (length(btrim("salesperson_assignments"."change_reason")) > 0),
	CONSTRAINT "salesperson_assignments_effective_range_check" CHECK ("salesperson_assignments"."effective_to" is null or "salesperson_assignments"."effective_to" > "salesperson_assignments"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "treasury_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(160) NOT NULL,
	"type" varchar(20) NOT NULL,
	"currency" varchar(10) DEFAULT 'VND' NOT NULL,
	"bank_name" varchar(160),
	"bank_account_number" varchar(80),
	"opening_balance" numeric(15, 0) DEFAULT '0' NOT NULL,
	"opening_balance_date" date,
	"cutover_at" timestamp with time zone,
	"opening_governance_action_id" integer,
	"status" varchar(20) DEFAULT 'DRAFT' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" integer NOT NULL,
	"updated_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treasury_accounts_type_check" CHECK ("treasury_accounts"."type" in ('CASH', 'BANK')),
	CONSTRAINT "treasury_accounts_currency_check" CHECK ("treasury_accounts"."currency" = 'VND'),
	CONSTRAINT "treasury_accounts_status_check" CHECK ("treasury_accounts"."status" in ('DRAFT', 'ACTIVE', 'INACTIVE')),
	CONSTRAINT "treasury_accounts_version_check" CHECK ("treasury_accounts"."version" > 0),
	CONSTRAINT "treasury_accounts_code_check" CHECK (length(btrim("treasury_accounts"."code")) > 0),
	CONSTRAINT "treasury_accounts_name_check" CHECK (length(btrim("treasury_accounts"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "treasury_movements" (
	"id" serial PRIMARY KEY NOT NULL,
	"treasury_account_id" integer NOT NULL,
	"direction" varchar(10) NOT NULL,
	"amount" numeric(15, 0) NOT NULL,
	"value_date" date NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" varchar(20) DEFAULT 'POSTED' NOT NULL,
	"payment_receipt_id" integer,
	"ledger_entry_id" integer,
	"source_version" integer NOT NULL,
	"payment_contract_version" integer NOT NULL,
	"physical_reference" varchar(160) NOT NULL,
	"external_reference" varchar(160),
	"governance_action_id" integer,
	"reversal_of_id" integer,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treasury_movements_direction_check" CHECK ("treasury_movements"."direction" in ('IN', 'OUT')),
	CONSTRAINT "treasury_movements_amount_check" CHECK ("treasury_movements"."amount" > 0),
	CONSTRAINT "treasury_movements_status_check" CHECK ("treasury_movements"."status" in ('POSTED', 'REVERSED')),
	CONSTRAINT "treasury_movements_source_version_check" CHECK ("treasury_movements"."source_version" > 0),
	CONSTRAINT "treasury_movements_contract_version_check" CHECK ("treasury_movements"."payment_contract_version" > 0),
	CONSTRAINT "treasury_movements_physical_reference_check" CHECK (length(btrim("treasury_movements"."physical_reference")) > 0),
	CONSTRAINT "treasury_movements_exactly_one_source_check" CHECK ((case when "treasury_movements"."payment_receipt_id" is null then 0 else 1 end)
      + (case when "treasury_movements"."ledger_entry_id" is null then 0 else 1 end) = 1)
);
--> statement-breakpoint
CREATE TABLE "trip_financial_postings" (
	"id" serial PRIMARY KEY NOT NULL,
	"trip_id" integer NOT NULL,
	"version" integer NOT NULL,
	"trip_version" integer NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"reason" varchar(30) NOT NULL,
	"governance_action_id" integer,
	"supersedes_id" integer,
	"effective_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_financial_postings_version_check" CHECK ("trip_financial_postings"."version" > 0),
	CONSTRAINT "trip_financial_postings_trip_version_check" CHECK ("trip_financial_postings"."trip_version" > 0),
	CONSTRAINT "trip_financial_postings_status_check" CHECK ("trip_financial_postings"."status" in ('ACTIVE', 'SUPERSEDED', 'REVERSED')),
	CONSTRAINT "trip_financial_postings_reason_check" CHECK ("trip_financial_postings"."reason" in ('COMPLETION', 'GOVERNED_CORRECTION', 'CANCELLATION'))
);
--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "legal_invoice_ref" jsonb;--> statement-breakpoint
ALTER TABLE "customer_email_logs" ADD COLUMN "customer_visible_event_id" integer;--> statement-breakpoint
ALTER TABLE "dispatch_handoffs" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "dispatch_handoffs" ADD COLUMN "accepted_by" integer;--> statement-breakpoint
ALTER TABLE "dispatch_handoffs" ADD COLUMN "supersedes_handoff_id" integer;--> statement-breakpoint
ALTER TABLE "dispatch_handoffs" ADD COLUMN "superseded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ledger" ADD COLUMN "financial_posting_id" integer;--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD COLUMN "treasury_account_id" integer;--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD COLUMN "value_date" date;--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD COLUMN "physical_reference" varchar(160);--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD COLUMN "payment_contract_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "trip_expenses" ADD COLUMN "recoverable_principal_amount" numeric(15, 0);--> statement-breakpoint
ALTER TABLE "trip_expenses" ADD COLUMN "service_fee_amount" numeric(15, 0);--> statement-breakpoint
ALTER TABLE "billing_document_disputes" ADD CONSTRAINT "billing_document_disputes_document_id_billing_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."billing_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_document_disputes" ADD CONSTRAINT "billing_document_disputes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_document_disputes" ADD CONSTRAINT "billing_document_disputes_disputed_by_users_id_fk" FOREIGN KEY ("disputed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_document_recoverable_claims" ADD CONSTRAINT "billing_document_recoverable_claims_document_id_billing_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."billing_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_document_recoverable_claims" ADD CONSTRAINT "billing_document_recoverable_claims_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_event_acknowledgements" ADD CONSTRAINT "customer_event_acknowledgements_event_id_customer_visible_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."customer_visible_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_event_acknowledgements" ADD CONSTRAINT "customer_event_acknowledgements_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_event_acknowledgements" ADD CONSTRAINT "customer_event_acknowledgements_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_visible_events" ADD CONSTRAINT "customer_visible_events_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_visible_events" ADD CONSTRAINT "customer_visible_events_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_visible_events" ADD CONSTRAINT "customer_visible_events_milestone_id_shipment_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."shipment_milestones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_visible_events" ADD CONSTRAINT "customer_visible_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profitability_snapshot_dimensions" ADD CONSTRAINT "profitability_snapshot_dimensions_snapshot_id_profitability_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."profitability_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profitability_snapshots" ADD CONSTRAINT "profitability_snapshots_financial_posting_id_trip_financial_postings_id_fk" FOREIGN KEY ("financial_posting_id") REFERENCES "public"."trip_financial_postings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profitability_snapshots" ADD CONSTRAINT "profitability_snapshots_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profitability_snapshots" ADD CONSTRAINT "profitability_snapshots_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesperson_assignments" ADD CONSTRAINT "salesperson_assignments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesperson_assignments" ADD CONSTRAINT "salesperson_assignments_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesperson_assignments" ADD CONSTRAINT "salesperson_assignments_salesperson_user_id_users_id_fk" FOREIGN KEY ("salesperson_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesperson_assignments" ADD CONSTRAINT "salesperson_assignments_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_accounts" ADD CONSTRAINT "treasury_accounts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_accounts" ADD CONSTRAINT "treasury_accounts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_movements" ADD CONSTRAINT "treasury_movements_treasury_account_id_treasury_accounts_id_fk" FOREIGN KEY ("treasury_account_id") REFERENCES "public"."treasury_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_movements" ADD CONSTRAINT "treasury_movements_payment_receipt_id_payment_receipts_id_fk" FOREIGN KEY ("payment_receipt_id") REFERENCES "public"."payment_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_movements" ADD CONSTRAINT "treasury_movements_ledger_entry_id_ledger_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."ledger"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_movements" ADD CONSTRAINT "treasury_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_financial_postings" ADD CONSTRAINT "trip_financial_postings_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_document_disputes_idempotency_uniq" ON "billing_document_disputes" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "billing_document_disputes_document_idx" ON "billing_document_disputes" USING btree ("document_id","disputed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_document_recoverable_claims_expense_uniq" ON "billing_document_recoverable_claims" USING btree ("expense_id");--> statement-breakpoint
CREATE INDEX "billing_document_recoverable_claims_document_idx" ON "billing_document_recoverable_claims" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_event_ack_actor_kind_uniq" ON "customer_event_acknowledgements" USING btree ("event_id","acknowledged_by","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_event_ack_idempotency_uniq" ON "customer_event_acknowledgements" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "customer_event_ack_customer_idx" ON "customer_event_acknowledgements" USING btree ("customer_id","acknowledged_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_visible_events_key_version_uniq" ON "customer_visible_events" USING btree ("event_key","content_version");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_visible_events_supersedes_uniq" ON "customer_visible_events" USING btree ("supersedes_event_id") WHERE "customer_visible_events"."supersedes_event_id" is not null;--> statement-breakpoint
CREATE INDEX "customer_visible_events_shipment_idx" ON "customer_visible_events" USING btree ("shipment_id","occurred_at");--> statement-breakpoint
CREATE INDEX "customer_visible_events_customer_idx" ON "customer_visible_events" USING btree ("customer_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "profitability_snapshot_dimensions_uniq" ON "profitability_snapshot_dimensions" USING btree ("snapshot_id","dimension");--> statement-breakpoint
CREATE INDEX "profitability_snapshot_dimensions_lookup_idx" ON "profitability_snapshot_dimensions" USING btree ("dimension","dimension_key");--> statement-breakpoint
CREATE UNIQUE INDEX "profitability_snapshots_posting_uniq" ON "profitability_snapshots" USING btree ("financial_posting_id");--> statement-breakpoint
CREATE INDEX "profitability_snapshots_business_date_idx" ON "profitability_snapshots" USING btree ("completed_business_date");--> statement-breakpoint
CREATE UNIQUE INDEX "salesperson_assignments_customer_default_active_uniq" ON "salesperson_assignments" USING btree ("customer_id") WHERE "salesperson_assignments"."shipment_id" is null and "salesperson_assignments"."effective_to" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "salesperson_assignments_shipment_active_uniq" ON "salesperson_assignments" USING btree ("shipment_id") WHERE "salesperson_assignments"."shipment_id" is not null and "salesperson_assignments"."effective_to" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "salesperson_assignments_supersedes_uniq" ON "salesperson_assignments" USING btree ("supersedes_assignment_id") WHERE "salesperson_assignments"."supersedes_assignment_id" is not null;--> statement-breakpoint
CREATE INDEX "salesperson_assignments_lookup_idx" ON "salesperson_assignments" USING btree ("customer_id","shipment_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "treasury_accounts_code_uniq" ON "treasury_accounts" USING btree ("code");--> statement-breakpoint
CREATE INDEX "treasury_accounts_type_status_idx" ON "treasury_accounts" USING btree ("type","status");--> statement-breakpoint
CREATE UNIQUE INDEX "treasury_movements_physical_posted_uniq" ON "treasury_movements" USING btree ("treasury_account_id","direction","physical_reference") WHERE "treasury_movements"."status" = 'POSTED';--> statement-breakpoint
CREATE UNIQUE INDEX "treasury_movements_receipt_posted_uniq" ON "treasury_movements" USING btree ("payment_receipt_id") WHERE "treasury_movements"."payment_receipt_id" is not null and "treasury_movements"."status" = 'POSTED';--> statement-breakpoint
CREATE UNIQUE INDEX "treasury_movements_ledger_posted_uniq" ON "treasury_movements" USING btree ("ledger_entry_id") WHERE "treasury_movements"."ledger_entry_id" is not null and "treasury_movements"."status" = 'POSTED';--> statement-breakpoint
CREATE UNIQUE INDEX "treasury_movements_reversal_uniq" ON "treasury_movements" USING btree ("reversal_of_id") WHERE "treasury_movements"."reversal_of_id" is not null;--> statement-breakpoint
CREATE INDEX "treasury_movements_account_date_idx" ON "treasury_movements" USING btree ("treasury_account_id","value_date");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_financial_postings_trip_version_uniq" ON "trip_financial_postings" USING btree ("trip_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_financial_postings_trip_active_uniq" ON "trip_financial_postings" USING btree ("trip_id") WHERE "trip_financial_postings"."status" = 'ACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX "trip_financial_postings_supersedes_uniq" ON "trip_financial_postings" USING btree ("supersedes_id") WHERE "trip_financial_postings"."supersedes_id" is not null;--> statement-breakpoint
CREATE INDEX "trip_financial_postings_trip_status_idx" ON "trip_financial_postings" USING btree ("trip_id","status");--> statement-breakpoint
ALTER TABLE "customer_email_logs" ADD CONSTRAINT "customer_email_logs_customer_visible_event_id_customer_visible_events_id_fk" FOREIGN KEY ("customer_visible_event_id") REFERENCES "public"."customer_visible_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_handoffs" ADD CONSTRAINT "dispatch_handoffs_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_financial_posting_id_trip_financial_postings_id_fk" FOREIGN KEY ("financial_posting_id") REFERENCES "public"."trip_financial_postings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_treasury_account_id_treasury_accounts_id_fk" FOREIGN KEY ("treasury_account_id") REFERENCES "public"."treasury_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_email_logs_visible_event_idx" ON "customer_email_logs" USING btree ("customer_visible_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dispatch_handoffs_supersedes_uniq" ON "dispatch_handoffs" USING btree ("supersedes_handoff_id") WHERE "dispatch_handoffs"."supersedes_handoff_id" is not null;--> statement-breakpoint
CREATE INDEX "ledger_financial_posting_idx" ON "ledger" USING btree ("financial_posting_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_milestones_trip_type_uniq" ON "shipment_milestones" USING btree ("shipment_id","trip_id","type") WHERE "shipment_milestones"."trip_id" is not null;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD CONSTRAINT "billing_documents_version_check" CHECK ("billing_documents"."version" > 0);--> statement-breakpoint
ALTER TABLE "dispatch_handoffs" ADD CONSTRAINT "dispatch_handoffs_version_check" CHECK ("dispatch_handoffs"."version" > 0);--> statement-breakpoint
ALTER TABLE "dispatch_handoffs" ADD CONSTRAINT "dispatch_handoffs_acceptance_actor_check" CHECK ("dispatch_handoffs"."status" <> 'ACCEPTED' or "dispatch_handoffs"."version" = 1 or ("dispatch_handoffs"."accepted_by" is not null and "dispatch_handoffs"."resolved_at" is not null));--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_contract_version_check" CHECK ("payment_receipts"."payment_contract_version" >= 1);--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_physical_reference_check" CHECK ("payment_receipts"."physical_reference" is null or length(btrim("payment_receipts"."physical_reference")) > 0);--> statement-breakpoint
ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_recoverable_split_nonnegative_check" CHECK (("trip_expenses"."recoverable_principal_amount" is null or "trip_expenses"."recoverable_principal_amount" >= 0)
      and ("trip_expenses"."service_fee_amount" is null or "trip_expenses"."service_fee_amount" >= 0));--> statement-breakpoint
ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_recoverable_split_consistency_check" CHECK (("trip_expenses"."recoverable_principal_amount" is null and "trip_expenses"."service_fee_amount" is null)
      or ("trip_expenses"."recoverable_principal_amount" is not null and "trip_expenses"."service_fee_amount" is not null
        and "trip_expenses"."recoverable_principal_amount" + "trip_expenses"."service_fee_amount" = "trip_expenses"."sell_amount"));
