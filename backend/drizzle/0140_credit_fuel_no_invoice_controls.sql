CREATE TYPE "public"."credit_override_scope" AS ENUM('SHIPMENT', 'EXPIRY');--> statement-breakpoint
CREATE TYPE "public"."credit_override_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELED');--> statement-breakpoint
CREATE TYPE "public"."credit_override_tier" AS ENUM('FINANCE_TIER_1', 'DIRECTOR');--> statement-breakpoint
CREATE TABLE "credit_override_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"shipment_id" integer,
	"scope_type" "credit_override_scope" NOT NULL,
	"status" "credit_override_status" DEFAULT 'PENDING' NOT NULL,
	"required_tier" "credit_override_tier" NOT NULL,
	"reason" text NOT NULL,
	"requested_by" integer NOT NULL,
	"requested_role" varchar(20) NOT NULL,
	"proposed_amount" numeric(15, 0) NOT NULL,
	"outstanding_amount" numeric(15, 0) NOT NULL,
	"approved_commitment_amount" numeric(15, 0) NOT NULL,
	"total_exposure" numeric(15, 0) NOT NULL,
	"credit_limit" numeric(15, 0) NOT NULL,
	"warning_threshold" numeric(4, 2) NOT NULL,
	"over_limit_amount" numeric(15, 0) NOT NULL,
	"over_limit_ratio" numeric(8, 4) NOT NULL,
	"repeat_exception" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone,
	"approved_by" integer,
	"approved_role" varchar(20),
	"approved_at" timestamp with time zone,
	"rejected_by" integer,
	"rejected_role" varchar(20),
	"rejected_at" timestamp with time zone,
	"rejection_reason" text,
	"consumed_trip_id" integer,
	"consumed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_override_requests_reason_check" CHECK (length(btrim("credit_override_requests"."reason")) > 0),
	CONSTRAINT "credit_override_requests_amounts_nonneg_check" CHECK ("credit_override_requests"."proposed_amount" >= 0 and "credit_override_requests"."outstanding_amount" >= 0 and "credit_override_requests"."approved_commitment_amount" >= 0 and "credit_override_requests"."total_exposure" >= 0 and "credit_override_requests"."credit_limit" > 0 and "credit_override_requests"."over_limit_amount" >= 0 and "credit_override_requests"."over_limit_ratio" >= 0),
	CONSTRAINT "credit_override_requests_scope_check" CHECK (("credit_override_requests"."scope_type" = 'SHIPMENT' and "credit_override_requests"."shipment_id" is not null and "credit_override_requests"."expires_at" is null) or ("credit_override_requests"."scope_type" = 'EXPIRY' and "credit_override_requests"."shipment_id" is null and "credit_override_requests"."expires_at" is not null)),
	CONSTRAINT "credit_override_requests_approval_actor_check" CHECK ("credit_override_requests"."status" <> 'APPROVED' or ("credit_override_requests"."approved_by" is not null and "credit_override_requests"."approved_at" is not null)),
	CONSTRAINT "credit_override_requests_rejection_actor_check" CHECK ("credit_override_requests"."status" <> 'REJECTED' or ("credit_override_requests"."rejected_by" is not null and "credit_override_requests"."rejected_at" is not null and "credit_override_requests"."rejection_reason" is not null)),
	CONSTRAINT "credit_override_requests_distinct_approver_check" CHECK ("credit_override_requests"."approved_by" is null or "credit_override_requests"."approved_by" <> "credit_override_requests"."requested_by"),
	CONSTRAINT "credit_override_requests_distinct_rejector_check" CHECK ("credit_override_requests"."rejected_by" is null or "credit_override_requests"."rejected_by" <> "credit_override_requests"."requested_by")
);
--> statement-breakpoint
CREATE TABLE "fuel_invoice_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"fuel_invoice_id" integer NOT NULL,
	"trip_id" integer NOT NULL,
	"truck_id" integer,
	"trip_expense_id" integer,
	"voucher_reference" varchar(120) NOT NULL,
	"voucher_date" date NOT NULL,
	"liters" numeric(15, 2) NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_invoice_allocations_liters_positive_check" CHECK ("fuel_invoice_allocations"."liters" > 0),
	CONSTRAINT "fuel_invoice_allocations_amount_positive_check" CHECK ("fuel_invoice_allocations"."amount" > 0),
	CONSTRAINT "fuel_invoice_allocations_voucher_reference_not_blank_check" CHECK (length(btrim("fuel_invoice_allocations"."voucher_reference")) > 0)
);
--> statement-breakpoint
CREATE TABLE "fuel_invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"supplier_id" integer NOT NULL,
	"invoice_number" varchar(80) NOT NULL,
	"invoice_date" date NOT NULL,
	"currency" varchar(10) DEFAULT 'VND' NOT NULL,
	"total_liters" numeric(15, 2) NOT NULL,
	"unit_price" numeric(15, 2) NOT NULL,
	"total_amount" numeric(15, 2) NOT NULL,
	"approval_status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"note" text,
	"created_by" integer,
	"approved_by" integer,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_invoices_currency_check" CHECK ("fuel_invoices"."currency" in ('VND')),
	CONSTRAINT "fuel_invoices_status_check" CHECK ("fuel_invoices"."approval_status" in ('PENDING', 'APPROVED', 'REJECTED')),
	CONSTRAINT "fuel_invoices_total_liters_positive_check" CHECK ("fuel_invoices"."total_liters" > 0),
	CONSTRAINT "fuel_invoices_unit_price_positive_check" CHECK ("fuel_invoices"."unit_price" > 0),
	CONSTRAINT "fuel_invoices_total_amount_positive_check" CHECK ("fuel_invoices"."total_amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" serial PRIMARY KEY NOT NULL,
	"normalized_tax_code" varchar(40) NOT NULL,
	"display_tax_code" varchar(40) NOT NULL,
	"currency" varchar(10) DEFAULT 'VND' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "partners_normalized_tax_code_not_blank_check" CHECK (length(btrim("partners"."normalized_tax_code")) > 0),
	CONSTRAINT "partners_currency_check" CHECK ("partners"."currency" in ('VND'))
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "partner_id" integer;--> statement-breakpoint
ALTER TABLE "debt_offsets" ADD COLUMN "partner_id" integer;--> statement-breakpoint
ALTER TABLE "debt_offsets" ADD COLUMN "currency" varchar(10) DEFAULT 'VND' NOT NULL;--> statement-breakpoint
ALTER TABLE "debt_offsets" ADD COLUMN "minutes_reference" varchar(120);--> statement-breakpoint
ALTER TABLE "debt_offsets" ADD COLUMN "minutes_document_hash" varchar(120);--> statement-breakpoint
ALTER TABLE "forwarder_expense_types" ADD COLUMN "no_invoice_evidence_types" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "forwarder_expense_types" ADD COLUMN "no_invoice_per_item_limit" numeric(15, 0) DEFAULT '1000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "forwarder_expense_types" ADD COLUMN "no_invoice_per_day_limit" numeric(15, 0) DEFAULT '5000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "forwarder_expense_types" ADD COLUMN "no_invoice_finance_lead_item_approval_limit" numeric(15, 0) DEFAULT '5000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "forwarder_expense_types" ADD COLUMN "no_invoice_director_day_approval_limit" numeric(15, 0) DEFAULT '10000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "forwarder_expense_types" ADD COLUMN "no_invoice_policy_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "partner_id" integer;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "primary_type" varchar(30);--> statement-breakpoint
ALTER TABLE "trip_expenses" ADD COLUMN "expense_date" date;--> statement-breakpoint
ALTER TABLE "trip_expenses" ADD COLUMN "payee_name" varchar(200);--> statement-breakpoint
ALTER TABLE "trip_expenses" ADD COLUMN "no_invoice_evidence_types" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "trip_expenses" ADD COLUMN "no_invoice_policy_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "trip_expenses" ADD COLUMN "return_for_evidence_reason" text;--> statement-breakpoint
ALTER TABLE "trip_expenses" ADD COLUMN "returned_for_evidence_at" timestamp;--> statement-breakpoint
ALTER TABLE "trip_expenses" ADD COLUMN "returned_for_evidence_by" integer;--> statement-breakpoint
ALTER TABLE "credit_override_requests" ADD CONSTRAINT "credit_override_requests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_override_requests" ADD CONSTRAINT "credit_override_requests_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_override_requests" ADD CONSTRAINT "credit_override_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_override_requests" ADD CONSTRAINT "credit_override_requests_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_override_requests" ADD CONSTRAINT "credit_override_requests_rejected_by_users_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_override_requests" ADD CONSTRAINT "credit_override_requests_consumed_trip_id_trips_id_fk" FOREIGN KEY ("consumed_trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_invoice_allocations" ADD CONSTRAINT "fuel_invoice_allocations_fuel_invoice_id_fuel_invoices_id_fk" FOREIGN KEY ("fuel_invoice_id") REFERENCES "public"."fuel_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_invoice_allocations" ADD CONSTRAINT "fuel_invoice_allocations_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_invoice_allocations" ADD CONSTRAINT "fuel_invoice_allocations_truck_id_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_invoice_allocations" ADD CONSTRAINT "fuel_invoice_allocations_trip_expense_id_trip_expenses_id_fk" FOREIGN KEY ("trip_expense_id") REFERENCES "public"."trip_expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_invoices" ADD CONSTRAINT "fuel_invoices_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_invoices" ADD CONSTRAINT "fuel_invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_invoices" ADD CONSTRAINT "fuel_invoices_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_override_requests_customer_idx" ON "credit_override_requests" USING btree ("customer_id","status","created_at");--> statement-breakpoint
CREATE INDEX "credit_override_requests_shipment_idx" ON "credit_override_requests" USING btree ("shipment_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_override_requests_active_shipment_uniq" ON "credit_override_requests" USING btree ("shipment_id") WHERE "credit_override_requests"."shipment_id" is not null and "credit_override_requests"."status" in ('PENDING', 'APPROVED');--> statement-breakpoint
CREATE INDEX "fuel_invoice_allocations_invoice_idx" ON "fuel_invoice_allocations" USING btree ("fuel_invoice_id");--> statement-breakpoint
CREATE INDEX "fuel_invoice_allocations_truck_idx" ON "fuel_invoice_allocations" USING btree ("truck_id","voucher_date");--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_invoice_allocations_trip_expense_uniq_idx" ON "fuel_invoice_allocations" USING btree ("trip_expense_id") WHERE "fuel_invoice_allocations"."trip_expense_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_invoice_allocations_invoice_voucher_uniq_idx" ON "fuel_invoice_allocations" USING btree ("fuel_invoice_id","trip_id","voucher_reference");--> statement-breakpoint
CREATE INDEX "fuel_invoices_supplier_idx" ON "fuel_invoices" USING btree ("supplier_id","invoice_date");--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_invoices_supplier_invoice_uniq_idx" ON "fuel_invoices" USING btree ("supplier_id",lower(btrim("invoice_number")),"invoice_date");--> statement-breakpoint
CREATE UNIQUE INDEX "partners_normalized_tax_code_uniq_idx" ON "partners" USING btree ("normalized_tax_code");--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debt_offsets" ADD CONSTRAINT "debt_offsets_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_returned_for_evidence_by_users_id_fk" FOREIGN KEY ("returned_for_evidence_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customers_partner_idx" ON "customers" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "debt_offsets_partner_idx" ON "debt_offsets" USING btree ("partner_id","offset_date");--> statement-breakpoint
CREATE INDEX "suppliers_partner_idx" ON "suppliers" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "trip_expenses_no_invoice_aggregate_idx" ON "trip_expenses" USING btree ("expense_type","expense_date","payee_name");--> statement-breakpoint
ALTER TABLE "debt_offsets" ADD CONSTRAINT "debt_offsets_currency_check" CHECK ("debt_offsets"."currency" in ('VND'));--> statement-breakpoint
ALTER TABLE "debt_offsets" ADD CONSTRAINT "debt_offsets_minutes_reference_not_blank_check" CHECK ("debt_offsets"."minutes_reference" is null or length(btrim("debt_offsets"."minutes_reference")) > 0);--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_primary_type_check" CHECK ("suppliers"."primary_type" is null or "suppliers"."primary_type" in ('CARRIER', 'PORT', 'WAREHOUSE', 'SHIPPING_LINE', 'CUSTOMS', 'SERVICE', 'FUEL'));