CREATE EXTENSION IF NOT EXISTS "vector";--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "unaccent";--> statement-breakpoint
CREATE TABLE "advance_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"requester_id" integer NOT NULL,
	"amount" numeric(15, 0) NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"approved_by" integer,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "advance_settlement_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"settlement_id" integer NOT NULL,
	"advance_request_id" integer NOT NULL,
	"allocated_amount" numeric(15, 0) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "advance_settlements" (
	"id" serial PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"code" varchar(20) NOT NULL,
	"forwarder_id" integer NOT NULL,
	"total_expense_amount" numeric(15, 0) NOT NULL,
	"refund_amount" numeric(15, 0) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"checked_by" integer,
	"checked_at" timestamp,
	"approved_by" integer,
	"approved_at" timestamp,
	"auto_offset_expense_id" integer,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"role" text NOT NULL,
	"title" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"role" varchar(16) NOT NULL,
	"content" text,
	"response" jsonb,
	"tool_trace" jsonb,
	"directives" jsonb,
	"tokens_in" integer,
	"tokens_out" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ancillary_revenue" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"shipment_id" integer,
	"trip_id" integer,
	"type" text NOT NULL,
	"amount" numeric(15, 0) NOT NULL,
	"tax" numeric(15, 0) DEFAULT '0',
	"date" date DEFAULT now() NOT NULL,
	"document_ref" varchar(100),
	"note" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"setting_key" varchar(120) PRIMARY KEY NOT NULL,
	"setting_value" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"user_id" integer,
	"actor_name" varchar(255),
	"message" text NOT NULL,
	"entity_type" varchar(50),
	"entity_id" integer,
	"payload" jsonb,
	"ip_address" varchar(45),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_document_disputes" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"document_version" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"disputed_by" integer NOT NULL,
	"reason" text NOT NULL,
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"idempotency_key" varchar(100) NOT NULL,
	"disputed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_document_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"source_type" varchar(20) NOT NULL,
	"source_id" integer,
	"source_version" varchar(120),
	"source_changed_at" timestamp with time zone,
	"financial_posting_id" integer,
	"financial_posting_version" integer,
	"posting_checksum" varchar(64),
	"line_type" varchar(20) NOT NULL,
	"type_label" varchar(100) DEFAULT 'Khác' NOT NULL,
	"unit" varchar(50) DEFAULT 'lần' NOT NULL,
	"description" text NOT NULL,
	"route_name" varchar(255),
	"container_numbers" text,
	"render_data" jsonb,
	"base_amount" numeric(15, 0) DEFAULT '0' NOT NULL,
	"amount_override" numeric(15, 0),
	"excluded" boolean DEFAULT false NOT NULL,
	"vat_treatment" varchar(20) DEFAULT 'EXEMPT' NOT NULL,
	"vat_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"vat_treatment_version" varchar(30) DEFAULT 'VAT-V1' NOT NULL,
	"net_amount" numeric(15, 0) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(15, 0) DEFAULT '0' NOT NULL,
	"gross_amount" numeric(15, 0) DEFAULT '0' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
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
	"released_at" timestamp with time zone,
	"released_by" integer,
	"release_reason" varchar(32)
);
--> statement-breakpoint
CREATE TABLE "billing_document_source_period_locks" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"period_lock_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_document_trip_claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"trip_id" integer NOT NULL,
	"financial_posting_id" integer NOT NULL,
	"financial_posting_version" integer NOT NULL,
	"posting_checksum" varchar(64) NOT NULL,
	"range_from" date NOT NULL,
	"range_to" date NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	"released_by" integer,
	"release_reason" varchar(32)
);
--> statement-breakpoint
CREATE TABLE "billing_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"type" varchar(20) NOT NULL,
	"entity_type" varchar(20) NOT NULL,
	"entity_id" integer NOT NULL,
	"entity_name" varchar(255),
	"range_from" date NOT NULL,
	"range_to" date NOT NULL,
	"note" text,
	"debit_note_template_id" integer,
	"debit_note_template_snapshot" jsonb,
	"official_identity_snapshot" jsonb,
	"legal_invoice_ref" jsonb,
	"total_incl_vat" numeric(15, 0) DEFAULT '0' NOT NULL,
	"total_net" numeric(15, 0) DEFAULT '0' NOT NULL,
	"total_tax" numeric(15, 0) DEFAULT '0' NOT NULL,
	"total_gross" numeric(15, 0) DEFAULT '0' NOT NULL,
	"vat_treatment_version" varchar(30) DEFAULT 'VAT-V1' NOT NULL,
	"debit_note_status" text DEFAULT 'DRAFT',
	"customer_confirmed_at" timestamp with time zone,
	"customer_confirmed_by" varchar(255),
	"ledger_adjustment_amount" numeric(15, 0) DEFAULT '0' NOT NULL,
	"original_due_date" date,
	"processing_due_date" date,
	"payment_term_days_applied" integer,
	"payment_date_policy_applied" varchar(30),
	"issued_at" timestamp with time zone,
	"authority_state" varchar(30) DEFAULT 'CURRENT' NOT NULL,
	"authority_warning_reason" text,
	"authority_warning_at" timestamp with time zone,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "business_calendar_days" (
	"id" serial PRIMARY KEY NOT NULL,
	"calendar_date" date NOT NULL,
	"name" varchar(255) NOT NULL,
	"is_working_day" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_units" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(50),
	"name" varchar(255) NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cap_table_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"partner_name" varchar(255) NOT NULL,
	"contribution_amount" numeric(15, 0) DEFAULT '0' NOT NULL,
	"percentage" numeric(5, 2) DEFAULT '0' NOT NULL,
	"effective_date" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cargo_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"requires_photos" boolean DEFAULT false,
	"is_bulk" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "container_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(20) NOT NULL,
	"name" varchar(50) NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "credit_override_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"shipment_id" integer,
	"scope_type" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"required_tier" text NOT NULL,
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
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_email_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"shipment_id" integer,
	"billing_document_id" integer,
	"customer_visible_event_id" integer,
	"subject" varchar(255) NOT NULL,
	"recipient_email" varchar(255),
	"status" text DEFAULT 'PENDING',
	"error_message" text,
	"provider_message_id" varchar(255),
	"retry_count" integer DEFAULT 0 NOT NULL,
	"sent_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
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
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"tax_code" varchar(20),
	"partner_id" integer,
	"contact_person" varchar(255),
	"phone" varchar(20),
	"contact_info" text,
	"credit_limit" numeric(15, 0),
	"credit_warning_threshold" numeric(3, 2),
	"payment_term_days" integer,
	"fuel_surcharge_share_pct" numeric(5, 2),
	"freight_payment_term_days" integer,
	"agency_fee_payment_term_days" integer,
	"payment_date_policy" varchar(30) DEFAULT 'NEXT_BUSINESS_DAY' NOT NULL,
	"status" text DEFAULT 'ACTIVE',
	"is_carrier" boolean DEFAULT false NOT NULL,
	"debit_note_mode" varchar(20) DEFAULT 'MONTHLY' NOT NULL,
	"debit_note_template_id" integer,
	"linked_supplier_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "debit_note_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"document_type" varchar(20) DEFAULT 'DEBIT_NOTE' NOT NULL,
	"title_text" varchar(100) DEFAULT 'GIẤY BÁO NỢ' NOT NULL,
	"issuer_name" varchar(200),
	"issuer_address" varchar(300),
	"issuer_tax_code" varchar(50),
	"issuer_representative" varchar(100),
	"accent_color" varchar(20) DEFAULT '#1F4E79' NOT NULL,
	"show_container_column" boolean DEFAULT true NOT NULL,
	"show_unit_column" boolean DEFAULT true NOT NULL,
	"grouping_mode" varchar(20) DEFAULT 'ROUTE' NOT NULL,
	"columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"amount_in_words" boolean DEFAULT false NOT NULL,
	"orientation" varchar(10) DEFAULT 'landscape' NOT NULL,
	"terms_text" text,
	"signature_left_label" varchar(100) DEFAULT 'Khách hàng',
	"signature_left_name" varchar(100),
	"signature_right_label" varchar(100) DEFAULT 'Kế toán trưởng',
	"signature_right_name" varchar(100),
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "debt_offsets" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"supplier_id" integer NOT NULL,
	"partner_id" integer,
	"amount" numeric(15, 0) NOT NULL,
	"offset_date" date NOT NULL,
	"currency" varchar(10) DEFAULT 'VND' NOT NULL,
	"minutes_reference" varchar(120),
	"minutes_document_hash" varchar(120),
	"note" text,
	"approval_status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"created_by" integer,
	"approved_by" integer,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delete_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" integer NOT NULL,
	"requested_by" integer NOT NULL,
	"reason" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"reviewed_by" integer,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispatch_handoffs" (
	"id" serial PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"shipment_id" integer NOT NULL,
	"handler_id" integer,
	"priority" varchar(20) DEFAULT 'NORMAL' NOT NULL,
	"vehicle_needed_by" timestamp,
	"operational_note" text,
	"status" text DEFAULT 'UNSEEN' NOT NULL,
	"handoff_version" integer NOT NULL,
	"created_by" integer,
	"dispatched_at" timestamp DEFAULT now() NOT NULL,
	"seen_at" timestamp,
	"resolved_at" timestamp,
	"accepted_by" integer,
	"supersedes_handoff_id" integer,
	"superseded_at" timestamp with time zone,
	"reject_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "distributions" (
	"id" serial PRIMARY KEY NOT NULL,
	"quarter" integer NOT NULL,
	"year" integer NOT NULL,
	"partner_name" varchar(255) NOT NULL,
	"amount" numeric(15, 0) NOT NULL,
	"truck_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_incidental_costs" (
	"id" serial PRIMARY KEY NOT NULL,
	"trip_id" integer NOT NULL,
	"driver_id" integer NOT NULL,
	"cost_type" text NOT NULL,
	"amount" numeric(15, 0) NOT NULL,
	"occurred_at" date NOT NULL,
	"note" text,
	"recorded_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_progress_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"trip_id" integer NOT NULL,
	"driver_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"note" text,
	"recorded_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_work_days" (
	"id" serial PRIMARY KEY NOT NULL,
	"driver_id" integer NOT NULL,
	"date" date NOT NULL,
	"status" text NOT NULL,
	"trip_id" integer,
	"note" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"name" varchar(255) NOT NULL,
	"phone" varchar(20),
	"assigned_truck_id" integer,
	"base_salary" numeric(15, 0),
	"social_insurance" numeric(15, 0) DEFAULT '0',
	"status" text DEFAULT 'ACTIVE',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "durable_effect_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" varchar(40) NOT NULL,
	"payload_version" smallint DEFAULT 1 NOT NULL,
	"dedupe_key" varchar(255) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 20 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" varchar(100),
	"lease_expires_at" timestamp with time zone,
	"last_error" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"is_renewable" boolean DEFAULT false,
	"reminder_lead_days" integer DEFAULT 30,
	"requires_invoice" boolean DEFAULT false,
	"substitute_evidence_allowed" boolean DEFAULT true,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "expense_photos" (
	"id" serial PRIMARY KEY NOT NULL,
	"expense_id" integer NOT NULL,
	"storage_key" varchar(255) NOT NULL,
	"uploaded_by" integer,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"expense_date" date NOT NULL,
	"supplier_id" integer NOT NULL,
	"category_id" integer NOT NULL,
	"truck_id" integer,
	"vehicle_component" text DEFAULT 'TRUCK',
	"amount" numeric(15, 0) NOT NULL,
	"payment_status" varchar(20) NOT NULL,
	"valid_from" timestamp,
	"valid_to" timestamp,
	"receipt_id" varchar(100),
	"note" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "faq_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"question_variants" text[] DEFAULT '{}' NOT NULL,
	"required_terms" text[] DEFAULT '{}' NOT NULL,
	"forbidden_terms" text[] DEFAULT '{}' NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"embedding" vector(1536),
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_reporting_policy_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"effective_from" date NOT NULL,
	"depreciation_method" varchar(30) NOT NULL,
	"allocation_basis" varchar(50) NOT NULL,
	"low_margin_threshold_ratio" numeric(5, 4),
	"governance_action_id" integer NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forwarder_expense_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"requires_invoice" boolean DEFAULT false,
	"substitute_evidence_allowed" boolean DEFAULT true,
	"no_invoice_evidence_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"no_invoice_per_item_limit" numeric(15, 0) DEFAULT '1000000' NOT NULL,
	"no_invoice_per_day_limit" numeric(15, 0) DEFAULT '5000000' NOT NULL,
	"no_invoice_finance_lead_item_approval_limit" numeric(15, 0) DEFAULT '5000000' NOT NULL,
	"no_invoice_director_day_approval_limit" numeric(15, 0) DEFAULT '10000000' NOT NULL,
	"no_invoice_finance_lead_approval_title" varchar(50) DEFAULT 'FINANCE_LEAD' NOT NULL,
	"no_invoice_director_approval_title" varchar(50) DEFAULT 'DIRECTOR' NOT NULL,
	"no_invoice_policy_version" integer DEFAULT 1 NOT NULL,
	"default_markup" boolean DEFAULT false NOT NULL,
	"billing_label" varchar(120),
	"vat_rate" numeric(5, 3) DEFAULT '0.080' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "fuel_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"loaded_norm" numeric(6, 2) NOT NULL,
	"empty_norm" numeric(6, 2) NOT NULL,
	"supplement" numeric(6, 2) DEFAULT '3',
	"unit_price" numeric(10, 0) NOT NULL,
	"base_unit_price" numeric(10, 0),
	"warning_threshold" numeric(6, 2) DEFAULT '37',
	"critical_threshold" numeric(6, 2) DEFAULT '40',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
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
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fuel_norms" (
	"id" serial PRIMARY KEY NOT NULL,
	"route_id" integer,
	"truck_id" integer,
	"loaded_liters_per_100km" numeric(8, 2) NOT NULL,
	"empty_liters_per_100km" numeric(8, 2) NOT NULL,
	"supplement_liters" numeric(8, 2) DEFAULT '0',
	"flat_rate_liters" numeric(8, 2),
	"effective_date" date DEFAULT now() NOT NULL,
	"note" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "fuel_period_adjustments" (
	"id" serial PRIMARY KEY NOT NULL,
	"governance_action_id" integer NOT NULL,
	"fuel_invoice_id" integer NOT NULL,
	"source_period_lock_id" integer NOT NULL,
	"source_period" varchar(7) NOT NULL,
	"target_period" varchar(7) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fuel_price_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"unit_price" numeric(10, 0) NOT NULL,
	"effective_date" timestamp NOT NULL,
	"changed_by" integer,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fuel_recon_explanations" (
	"id" serial PRIMARY KEY NOT NULL,
	"supplier_id" integer NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"explanation_text" text NOT NULL,
	"resolved_variance" numeric(15, 0) NOT NULL,
	"created_by" integer,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fuel_surcharge_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"share_rate" numeric(5, 4) DEFAULT '0' NOT NULL,
	"base_fuel_price" numeric(10, 0) NOT NULL,
	"effective_date" date DEFAULT now() NOT NULL,
	"note" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "governance_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"subject_type" varchar(30) NOT NULL,
	"subject_id" integer,
	"subject_key" varchar(120),
	"action_kind" varchar(40) NOT NULL,
	"status" varchar(30) DEFAULT 'PENDING_CHECK' NOT NULL,
	"reason" text NOT NULL,
	"original_version" integer NOT NULL,
	"original_period_lock_id" integer,
	"before_snapshot" jsonb NOT NULL,
	"after_snapshot" jsonb NOT NULL,
	"delta_snapshot" jsonb,
	"maker_id" integer NOT NULL,
	"maker_role" varchar(20),
	"checker_id" integer,
	"checker_role" varchar(20),
	"checked_at" timestamp with time zone,
	"approver_id" integer,
	"approver_role" varchar(20),
	"approved_at" timestamp with time zone,
	"rejected_by" integer,
	"rejected_role" varchar(20),
	"rejected_at" timestamp with time zone,
	"rejection_reason" text,
	"returned_by" integer,
	"returned_role" varchar(20),
	"returned_at" timestamp with time zone,
	"return_reason" text,
	"canceled_by" integer,
	"canceled_role" varchar(20),
	"canceled_at" timestamp with time zone,
	"cancel_reason" text,
	"applied_at" timestamp with time zone,
	"ledger_entry_id" integer,
	"application_result" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"endpoint" varchar(100) NOT NULL,
	"idempotency_key" varchar(100) NOT NULL,
	"entity_type" varchar(50),
	"entity_id" integer,
	"payload_hash" varchar(64) NOT NULL,
	"response_status_code" integer DEFAULT 200 NOT NULL,
	"response_snapshot" jsonb,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_chunks" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_type" text NOT NULL,
	"source_path" text NOT NULL,
	"heading" text NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536),
	"doc_version" text,
	"lang" text DEFAULT 'vi' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"txn_type" text NOT NULL,
	"txn_id" integer,
	"receipt_id" varchar(100),
	"entity_type" varchar(50) NOT NULL,
	"entity_id" integer NOT NULL,
	"credit" numeric(15, 0) DEFAULT '0',
	"debit" numeric(15, 0) DEFAULT '0',
	"balance" numeric(15, 0) NOT NULL,
	"note" text,
	"original_due_date" date,
	"processing_due_date" date,
	"payment_term_days_applied" integer,
	"payment_date_policy_applied" varchar(30),
	"financial_posting_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lift_pricing" (
	"id" serial PRIMARY KEY NOT NULL,
	"port_id" integer NOT NULL,
	"container_type_id" integer NOT NULL,
	"direction" text NOT NULL,
	"load_state" text DEFAULT 'LOADED' NOT NULL,
	"unit_price" numeric(15, 0) NOT NULL,
	"effective_date" date DEFAULT now() NOT NULL,
	"note" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "management_fees" (
	"id" serial PRIMARY KEY NOT NULL,
	"month" integer NOT NULL,
	"year" integer NOT NULL,
	"amount" numeric(15, 0) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "master_import_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_file_name" varchar(255) NOT NULL,
	"source_file_hash" varchar(64) NOT NULL,
	"parser_version" varchar(40) NOT NULL,
	"private_storage_key" varchar(255),
	"status" text DEFAULT 'ANALYZED' NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"warning_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"analyzed_by" integer NOT NULL,
	"applied_by" integer,
	"analyzed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "master_import_row_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_id" integer NOT NULL,
	"sheet_name" varchar(160) NOT NULL,
	"row_number" integer NOT NULL,
	"entity_type" varchar(80) NOT NULL,
	"classification" text NOT NULL,
	"natural_key_hash" varchar(64),
	"payload_hash" varchar(64),
	"reason_code" varchar(80),
	"redacted_reason" text,
	"applied_entity_type" varchar(80),
	"applied_entity_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" text NOT NULL,
	"title" varchar(255) NOT NULL,
	"message" text NOT NULL,
	"related_entity_type" varchar(50),
	"related_entity_id" integer,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operational_sites" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"code" varchar(80) NOT NULL,
	"name" varchar(255) NOT NULL,
	"site_type" text NOT NULL,
	"address" text NOT NULL,
	"google_maps_url" text,
	"contact_name" varchar(120),
	"contact_phone" varchar(30),
	"lift_fee_invoice_name" varchar(255),
	"lift_fee_invoice_address" text,
	"lift_fee_tax_code" varchar(40),
	"strict_rules" text,
	"version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" serial PRIMARY KEY NOT NULL,
	"normalized_tax_code" varchar(40) NOT NULL,
	"display_tax_code" varchar(40) NOT NULL,
	"currency" varchar(10) DEFAULT 'VND' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"receipt_id" varchar(100),
	"payment_receipt_id" integer,
	"allocation_order" integer,
	"original_due_date_snapshot" date,
	"processing_due_date_snapshot" date,
	"issue_timestamp_snapshot" timestamp,
	"customer_id" integer NOT NULL,
	"billing_document_id" integer,
	"source_trip_id" integer,
	"target_type" varchar(20) NOT NULL,
	"target_id" integer NOT NULL,
	"amount" numeric(15, 0) NOT NULL,
	"allocation_method" varchar(20) DEFAULT 'OLDEST_FIRST' NOT NULL,
	"allocated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_receipts" (
	"id" serial PRIMARY KEY NOT NULL,
	"receipt_id" varchar(100) NOT NULL,
	"customer_id" integer NOT NULL,
	"received_amount" numeric(15, 0) NOT NULL,
	"allocated_total" numeric(15, 0) NOT NULL,
	"unapplied_amount" numeric(15, 0) NOT NULL,
	"refunded_amount" numeric(15, 0) DEFAULT '0' NOT NULL,
	"allocation_method" varchar(20) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"treasury_account_id" integer,
	"value_date" date,
	"physical_reference" varchar(160),
	"payment_contract_version" integer DEFAULT 1 NOT NULL,
	"created_by" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_refunds" (
	"id" serial PRIMARY KEY NOT NULL,
	"payment_receipt_id" integer NOT NULL,
	"governance_action_id" integer NOT NULL,
	"amount" numeric(15, 0) NOT NULL,
	"reason" text NOT NULL,
	"created_by" integer NOT NULL,
	"approved_by" integer NOT NULL,
	"ledger_entry_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "penalties" (
	"id" serial PRIMARY KEY NOT NULL,
	"driver_id" integer NOT NULL,
	"trip_id" integer,
	"reason_id" integer,
	"custom_reason" text,
	"amount" numeric(15, 0) NOT NULL,
	"date" date NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "penalty_reasons" (
	"id" serial PRIMARY KEY NOT NULL,
	"reason_text" text NOT NULL,
	"default_amount" numeric(15, 0) NOT NULL,
	"severity" text DEFAULT 'mid' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
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
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photo_geotags" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" varchar(32) NOT NULL,
	"entity_id" integer NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"accuracy" double precision,
	"altitude" double precision,
	"gps_at" timestamp with time zone,
	"source" varchar(16) DEFAULT 'phone' NOT NULL,
	"sample_count" integer,
	"best_accuracy" double precision,
	"elapsed_ms" integer,
	"recorded_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ports" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"code" varchar(20),
	"address" text,
	"city" varchar(100) DEFAULT 'Hải Phòng',
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "pricing_tables" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"route_id" integer NOT NULL,
	"price" numeric(15, 0) NOT NULL,
	"container_type_id" integer,
	"rate_key" varchar(32),
	"effective_date" date DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "profitability_snapshot_dimensions" (
	"id" serial PRIMARY KEY NOT NULL,
	"snapshot_id" integer NOT NULL,
	"dimension" varchar(30) NOT NULL,
	"dimension_key" varchar(120) NOT NULL,
	"dimension_label" varchar(255) NOT NULL,
	"attribution_status" varchar(30) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
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
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"endpoint" varchar(500) NOT NULL,
	"keys_p256dh" varchar(200) NOT NULL,
	"keys_auth" varchar(100) NOT NULL,
	"device_type" varchar(20) DEFAULT 'web' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "road_allowances" (
	"id" serial PRIMARY KEY NOT NULL,
	"route_id" integer NOT NULL,
	"trailer_type" text NOT NULL,
	"base_amount" numeric(15, 0) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "road_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"toll_per_station" numeric(15, 0) NOT NULL,
	"return_cargo_bonus" numeric(15, 0) NOT NULL,
	"default_driver_salary" numeric(15, 0) DEFAULT '400000',
	"two_point_delivery_bonus" numeric(15, 0) DEFAULT '200000',
	"vehicle_shift_default" numeric(15, 0) DEFAULT '200000',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route_polylines" (
	"id" serial PRIMARY KEY NOT NULL,
	"origin_cleaned" varchar(255) NOT NULL,
	"destination_cleaned" varchar(255) NOT NULL,
	"encoded_polyline" text NOT NULL,
	"point_count" integer NOT NULL,
	"distance_km" numeric(10, 2) NOT NULL,
	"source_trip_id" integer,
	"route_id" integer,
	"derived_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routes" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"distance_km" integer,
	"is_mountain" boolean DEFAULT false,
	"fixed_fuel_allowance" numeric(10, 2),
	"tolls_stations" integer,
	"driver_salary" numeric(15, 0),
	"default_legs" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "salary_confirmations" (
	"id" serial PRIMARY KEY NOT NULL,
	"driver_id" integer NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"confirmed_by" integer,
	"confirmed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"payslip_issued_by" integer,
	"payslip_issued_at" timestamp with time zone,
	"payslip_issued_note" text,
	"official_posted_by" integer,
	"official_posted_at" timestamp with time zone,
	"official_posting_note" text,
	"payroll_scope" varchar(20),
	"payroll_business_unit_id" integer,
	"payroll_business_unit_name" text,
	"included_driver_ids" jsonb,
	"excluded_driver_ids" jsonb,
	"payroll_provenance_captured_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salary_periods" (
	"id" serial PRIMARY KEY NOT NULL,
	"month" integer,
	"year" integer,
	"start_date" date,
	"end_date" date,
	"label" varchar(100),
	"default_start_day" integer,
	"default_end_day" integer,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
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
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduler_run_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_name" varchar(64) NOT NULL,
	"cron" varchar(32) NOT NULL,
	"status" text DEFAULT 'RUNNING' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "seal_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(50) NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "settlement_expense_adjustments" (
	"id" serial PRIMARY KEY NOT NULL,
	"settlement_id" integer NOT NULL,
	"settlement_expense_id" integer NOT NULL,
	"trip_expense_id" integer NOT NULL,
	"sequence" integer NOT NULL,
	"source_version" integer NOT NULL,
	"before_snapshot" jsonb NOT NULL,
	"after_snapshot" jsonb NOT NULL,
	"reason" text NOT NULL,
	"adjusted_by" integer NOT NULL,
	"adjusted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" integer,
	"approved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "settlement_expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"settlement_id" integer NOT NULL,
	"trip_expense_id" integer NOT NULL,
	"original_buy_amount" numeric(15, 0) NOT NULL,
	"adjusted_buy_amount" numeric(15, 0) NOT NULL,
	"submitted_sell_amount" numeric(15, 0),
	"original_snapshot" jsonb NOT NULL,
	"adjusted_snapshot" jsonb NOT NULL,
	"adjustment_reason" text,
	"adjusted_by" integer,
	"adjusted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "shipment_change_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"shipment_id" integer NOT NULL,
	"source_version" integer NOT NULL,
	"request_kind" text NOT NULL,
	"requested_by" integer NOT NULL,
	"before_snapshot" jsonb NOT NULL,
	"after_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_containers" (
	"id" serial PRIMARY KEY NOT NULL,
	"shipment_id" integer NOT NULL,
	"container_type_id" integer,
	"container_number" varchar(50),
	"seal_number" varchar(50),
	"cargo_weight_kg" numeric(10, 2),
	"shipping_line_name" varchar(255),
	"pickup_port_id" integer,
	"dropoff_port_id" integer,
	"notes" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_declarations" (
	"id" serial PRIMARY KEY NOT NULL,
	"shipment_id" integer NOT NULL,
	"declaration_number" varchar(50),
	"issued_at" timestamp with time zone,
	"scope" text DEFAULT 'SINGLE',
	"note" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"shipment_id" integer NOT NULL,
	"type" text,
	"storage_key" varchar(255) NOT NULL,
	"uploaded_by" integer,
	"expires_at" date,
	"replaced_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_fulfillments" (
	"id" serial PRIMARY KEY NOT NULL,
	"shipment_id" integer NOT NULL,
	"fulfillment_type" text NOT NULL,
	"cargo_mode" text NOT NULL,
	"shipment_container_id" integer,
	"source_shipment_version" integer NOT NULL,
	"site_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"canceled_at" timestamp with time zone,
	"canceled_by" integer,
	"cancellation_reason" text,
	"cancellation_disposition" text,
	"replacement_fulfillment_id" integer,
	"not_required_approved_by" integer,
	"not_required_approved_at" timestamp with time zone,
	"not_required_reason" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_milestones" (
	"id" serial PRIMARY KEY NOT NULL,
	"shipment_id" integer NOT NULL,
	"type" text NOT NULL,
	"note" text,
	"trip_id" integer,
	"changed_by" integer,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_status_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"shipment_id" integer NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"reason" text,
	"changed_by" integer,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" serial PRIMARY KEY NOT NULL,
	"shipment_code" varchar(50),
	"version" integer DEFAULT 1 NOT NULL,
	"customer_id" integer NOT NULL,
	"route_id" integer,
	"cargo_type_id" integer,
	"responsible_unit_id" integer,
	"status" text DEFAULT 'NEW',
	"booking_ref" varchar(100),
	"bl_number" varchar(100),
	"trade_direction" text,
	"cargo_mode" text,
	"operational_site_id" integer,
	"pickup_warehouse_site_id" integer,
	"factory_name" varchar(255),
	"shipping_line_name" varchar(255),
	"expected_delivery_date" date,
	"customs_cutoff_at" timestamp with time zone,
	"closing_at" timestamp with time zone,
	"planned_return_at" timestamp with time zone,
	"cargo_weight_kg" numeric(10, 2),
	"cargo_volume_cbm" numeric(10, 3),
	"package_count" integer,
	"package_type" varchar(100),
	"operational_notes" text,
	"pickup_location" varchar(255),
	"delivery_location" varchar(255),
	"contact_name" varchar(100),
	"contact_phone" varchar(20),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"contact_person" varchar(255),
	"phone" varchar(20),
	"tax_code" varchar(20),
	"partner_id" integer,
	"note" text,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"linked_customer_id" integer,
	"is_fuel_supplier" boolean DEFAULT false NOT NULL,
	"types" text[],
	"primary_type" varchar(30),
	"chi_ho_due_days" integer,
	"cuoc_due_days" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "tire_positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "tires" (
	"id" serial PRIMARY KEY NOT NULL,
	"serial" varchar(64) NOT NULL,
	"truck_id" integer,
	"trailer_id" integer,
	"position" varchar(64),
	"size" varchar(32),
	"installed_at" date,
	"removed_at" date,
	"supplier_id" integer,
	"cost" numeric(15, 0) DEFAULT '0',
	"purchased_at" date,
	"status" varchar(20) DEFAULT 'IN_STOCK',
	"disposal_date" date,
	"disposal_reason" varchar(120),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "trailers" (
	"id" serial PRIMARY KEY NOT NULL,
	"license_plate" varchar(20) NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
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
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_code_counters" (
	"year_month" varchar(10) PRIMARY KEY NOT NULL,
	"counter" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_container_seals" (
	"id" serial PRIMARY KEY NOT NULL,
	"trip_container_id" integer NOT NULL,
	"seal_number" varchar(50) NOT NULL,
	"seal_type" varchar(30),
	"notes" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_containers" (
	"id" serial PRIMARY KEY NOT NULL,
	"trip_id" integer NOT NULL,
	"source_shipment_id" integer,
	"source_shipment_container_id" integer,
	"source_shipment_version" integer,
	"container_type_id" integer,
	"container_number" varchar(50),
	"seal_number" varchar(50),
	"cargo_weight_kg" numeric(10, 2),
	"notes" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_expense_completion_scopes" (
	"id" serial PRIMARY KEY NOT NULL,
	"trip_id" integer NOT NULL,
	"trip_container_id" integer,
	"status" varchar(20) DEFAULT 'IN_PROGRESS' NOT NULL,
	"completed_by" integer,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_expense_photos" (
	"id" serial PRIMARY KEY NOT NULL,
	"trip_expense_id" integer NOT NULL,
	"storage_key" varchar(255) NOT NULL,
	"uploaded_by" integer,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"trip_id" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"forwarder_id" integer,
	"created_by" integer,
	"expense_type" varchar(50) NOT NULL,
	"buy_amount" numeric(15, 0) NOT NULL,
	"sell_amount" numeric(15, 0) DEFAULT '0' NOT NULL,
	"recoverable_principal_amount" numeric(15, 0),
	"service_fee_amount" numeric(15, 0),
	"settlement_method" varchar(20) DEFAULT 'FORWARDER_ADVANCE' NOT NULL,
	"supplier_id" integer,
	"expense_date" date,
	"payee_name" varchar(200),
	"invoice_number" varchar(50),
	"invoice_date" date,
	"declaration_number" varchar(50),
	"container_number" varchar(20),
	"trip_container_id" integer,
	"lift_pricing_id" integer,
	"lift_pricing_snapshot" jsonb,
	"approval_status" varchar(20) DEFAULT 'APPROVED' NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" integer,
	"note" text,
	"no_invoice_evidence_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"no_invoice_policy_snapshot" jsonb,
	"return_for_evidence_reason" text,
	"returned_for_evidence_at" timestamp,
	"returned_for_evidence_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
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
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_gps_capture_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"governance_action_id" integer NOT NULL,
	"trip_id" integer NOT NULL,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" varchar(100),
	"lease_expires_at" timestamp with time zone,
	"last_error" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_gps_tracks" (
	"id" serial PRIMARY KEY NOT NULL,
	"trip_id" integer NOT NULL,
	"route_id" integer,
	"truck_id" integer,
	"car_id" integer,
	"license_plate" varchar(20),
	"encoded_polyline" text NOT NULL,
	"point_count" integer DEFAULT 0 NOT NULL,
	"distance_km" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"stops" jsonb,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"status" varchar(16) DEFAULT 'ok' NOT NULL,
	"segment_matched" boolean DEFAULT false NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error_kind" varchar(32)
);
--> statement-breakpoint
CREATE TABLE "trip_instructions" (
	"id" serial PRIMARY KEY NOT NULL,
	"trip_id" integer NOT NULL,
	"contact_name" varchar(100),
	"contact_phone" varchar(20),
	"notes" text,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_legs" (
	"id" serial PRIMARY KEY NOT NULL,
	"trip_id" integer NOT NULL,
	"sequence" integer NOT NULL,
	"origin" text NOT NULL,
	"destination" text NOT NULL,
	"km" integer NOT NULL,
	"loading_type" text NOT NULL,
	"calculated_liters" numeric(10, 2),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_pairs" (
	"id" serial PRIMARY KEY NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"first_trip_id" integer NOT NULL,
	"second_trip_id" integer NOT NULL,
	"empty_distance_km" numeric(10, 2),
	"combined_efficiency_percent" numeric(6, 2),
	"required_gap_minutes" integer,
	"actual_gap_minutes" integer,
	"break_reason" varchar(40),
	"surviving_trip_id" integer,
	"late_by_minutes" integer,
	"created_by" integer,
	"broken_by" integer,
	"broken_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_photos" (
	"id" serial PRIMARY KEY NOT NULL,
	"trip_id" integer NOT NULL,
	"type" text NOT NULL,
	"storage_key" varchar(255) NOT NULL,
	"uploaded_by" integer NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	"trip_container_id" integer
);
--> statement-breakpoint
CREATE TABLE "trip_pod_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"submission_id" integer NOT NULL,
	"file_type" text NOT NULL,
	"storage_key" varchar(255) NOT NULL,
	"original_file_name" varchar(255) NOT NULL,
	"mime_type" varchar(120) NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"uploaded_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_pod_submissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"trip_id" integer NOT NULL,
	"fulfillment_id" integer NOT NULL,
	"submission_version" integer NOT NULL,
	"source_trip_version" integer NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"supersedes_submission_id" integer,
	"submitted_by" integer,
	"submitted_at" timestamp with time zone,
	"reviewed_by" integer,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" serial PRIMARY KEY NOT NULL,
	"trip_code" varchar(50),
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" integer,
	"customer_id" integer NOT NULL,
	"customer_reference" text,
	"truck_id" integer,
	"driver_id" integer,
	"route_id" integer NOT NULL,
	"trailer_id" integer,
	"trailer_type" text,
	"cargo_type_id" integer,
	"container_count" integer DEFAULT 1,
	"status" text DEFAULT 'CREATED',
	"departure_date" date NOT NULL,
	"planned_start_at" timestamp,
	"planned_end_at" timestamp,
	"canonical_origin" varchar(160),
	"canonical_destination" varchar(160),
	"cargo_weight_kg" numeric(10, 2),
	"vehicle_capacity_kg" numeric(10, 2),
	"active_trip_pair_id" integer,
	"active_trip_pair_order" integer,
	"fuel_mode" text DEFAULT 'AUTO',
	"fuel_liters_override" numeric(10, 2),
	"fuel_supplement_liters" numeric(10, 2) DEFAULT '0',
	"fuel_supplement_reason" text,
	"tolls_discount" numeric(15, 0) DEFAULT '0',
	"tolls_addition" numeric(15, 0) DEFAULT '0',
	"tolls_stations" integer DEFAULT 0,
	"has_return_cargo" boolean DEFAULT false,
	"driver_salary" numeric(15, 0),
	"fuel_price_applied" numeric(10, 0),
	"fuel_actual_unit_price" numeric(10, 0),
	"road_allowance_base_applied" numeric(15, 0),
	"fuel_loaded_norm_applied" numeric(6, 2),
	"fuel_empty_norm_applied" numeric(6, 2),
	"fuel_fixed_allowance_applied" numeric(10, 2),
	"fuel_supplement_norm_applied" numeric(6, 2),
	"toll_per_station_applied" numeric(15, 0),
	"return_cargo_bonus_applied" numeric(15, 0),
	"fuel_liters" numeric(10, 2),
	"total_fuel_cost" numeric(15, 0),
	"fuel_surcharge_amount" numeric(15, 0) DEFAULT '0' NOT NULL,
	"fuel_surcharge_snapshot" jsonb,
	"fuel_surcharge_snapshot_dirty" boolean DEFAULT false NOT NULL,
	"total_road_allowance" numeric(15, 0),
	"toll_cost" numeric(15, 0),
	"toll_deduction" numeric(15, 0) DEFAULT '0' NOT NULL,
	"road_allowance_override" numeric(15, 0),
	"total_cost" numeric(15, 0),
	"revenue" numeric(15, 0),
	"revenue_empty_return" numeric(15, 0) DEFAULT '0',
	"revenue_combine" numeric(15, 0) DEFAULT '0',
	"two_point_delivery_bonus" numeric(15, 0) DEFAULT '0',
	"vehicle_shift_allowance" numeric(15, 0) DEFAULT '0',
	"storage_fee_revenue" numeric(15, 0),
	"gross_profit" numeric(15, 0),
	"revenue_original" numeric(15, 0),
	"revenue_overridden_by" integer,
	"revenue_overridden_at" timestamp,
	"revenue_override_reason" text,
	"pricing_source" text,
	"pricing_formula" text,
	"pricing_snapshot" jsonb,
	"notes" text,
	"customer_commission" numeric(15, 0) DEFAULT '0',
	"trip_wage_days" integer,
	"fuel_supplier_id" integer,
	"vat_rate" numeric(5, 3) DEFAULT '0.000' NOT NULL,
	"carrier_type" varchar(20) DEFAULT 'OWN' NOT NULL,
	"external_entity_id" integer,
	"external_entity_type" varchar(20),
	"external_freight_cost" numeric(15, 0),
	"external_plate_number" varchar(20),
	"external_driver_name" varchar(100),
	"external_driver_phone" varchar(20),
	"shipment_id" integer,
	"fulfillment_id" integer,
	"source_shipment_version" integer,
	"completed_at" timestamp,
	"pod_recovered_at" timestamp with time zone,
	"pod_recovered_by" integer,
	"ar_cost_hash" varchar(64),
	"ar_snapshot_dirty" boolean DEFAULT false NOT NULL,
	"ar_snapshot_changed_at" timestamp with time zone,
	"ap_cost_hash" varchar(64),
	"ap_snapshot_dirty" boolean DEFAULT false NOT NULL,
	"ap_snapshot_changed_at" timestamp with time zone,
	"pnl_snapshot_gross_profit" numeric(15, 0),
	"paper_order_collected_at" timestamp with time zone,
	"driver_order_accepted_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "truck_cap_table" (
	"id" serial PRIMARY KEY NOT NULL,
	"truck_id" integer NOT NULL,
	"partner_name" varchar(255) NOT NULL,
	"percentage" numeric(5, 2) DEFAULT '0' NOT NULL,
	"role" text DEFAULT 'INVESTOR' NOT NULL,
	"effective_date" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "truck_financial_profile_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"truck_id" integer NOT NULL,
	"effective_from" date NOT NULL,
	"acquisition_cost" numeric(15, 0) NOT NULL,
	"residual_value" numeric(15, 0) NOT NULL,
	"in_service_date" date NOT NULL,
	"useful_life_months" integer NOT NULL,
	"monthly_fixed_cost" numeric(15, 0) NOT NULL,
	"governance_action_id" integer NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trucks" (
	"id" serial PRIMARY KEY NOT NULL,
	"license_plate" varchar(20) NOT NULL,
	"trailer_plate_number" varchar(20),
	"trailer_type" text,
	"current_trailer_id" integer,
	"status" text DEFAULT 'ACTIVE',
	"next_inspection_date" date,
	"insurance_expiry_date" date,
	"last_oil_service_date" date,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "user_business_unit_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"business_unit_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_customer_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_shipment_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"shipment_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" varchar(100),
	"email" varchar(255),
	"phone" varchar(20),
	"full_name" varchar(255),
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'DRIVER' NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"customer_id" integer,
	"customer_account_type" text DEFAULT 'SINGLE_ENTITY' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "vehicle_last_positions" (
	"truck_id" integer PRIMARY KEY NOT NULL,
	"device_id" varchar(50),
	"lat" double precision,
	"lng" double precision,
	"speed" double precision,
	"angle" double precision,
	"address" text,
	"ignition_on" boolean DEFAULT false NOT NULL,
	"fuel" double precision,
	"gps_driver_name" varchar(255),
	"last_seen_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weight_pricing_tiers" (
	"id" serial PRIMARY KEY NOT NULL,
	"route_id" integer NOT NULL,
	"cargo_type_id" integer NOT NULL,
	"min_kg" numeric(12, 2) NOT NULL,
	"max_kg" numeric(12, 2) NOT NULL,
	"price_per_kg" numeric(12, 4) NOT NULL,
	"effective_date" date DEFAULT now() NOT NULL,
	"note" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE INDEX "adv_settlement_req_unique_idx" ON "advance_settlement_requests" USING btree ("settlement_id","advance_request_id");--> statement-breakpoint
CREATE INDEX "adv_settlement_req_request_idx" ON "advance_settlement_requests" USING btree ("advance_request_id");--> statement-breakpoint
CREATE INDEX "advance_settlements_code_unique_idx" ON "advance_settlements" USING btree ("code");--> statement-breakpoint
CREATE INDEX "advance_settlements_auto_offset_expense_uniq" ON "advance_settlements" USING btree ("auto_offset_expense_id") WHERE "advance_settlements"."auto_offset_expense_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "agent_conversations_user_updated_idx" ON "agent_conversations" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "agent_messages_conversation_idx" ON "agent_messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "ancillary_revenue_customer_date_idx" ON "ancillary_revenue" USING btree ("customer_id","date");--> statement-breakpoint
CREATE INDEX "ancillary_revenue_shipment_idx" ON "ancillary_revenue" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "ancillary_revenue_trip_idx" ON "ancillary_revenue" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "billing_document_disputes_idempotency_uniq" ON "billing_document_disputes" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "billing_document_disputes_document_idx" ON "billing_document_disputes" USING btree ("document_id","disputed_at");--> statement-breakpoint
CREATE INDEX "billing_document_lines_doc_idx" ON "billing_document_lines" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "billing_document_recoverable_claims_expense_active_uniq" ON "billing_document_recoverable_claims" USING btree ("expense_id") WHERE "billing_document_recoverable_claims"."released_at" is null;--> statement-breakpoint
CREATE INDEX "billing_document_recoverable_claims_document_idx" ON "billing_document_recoverable_claims" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "billing_document_source_period_locks_doc_period_uniq" ON "billing_document_source_period_locks" USING btree ("document_id","period_lock_id");--> statement-breakpoint
CREATE INDEX "billing_document_source_period_locks_period_idx" ON "billing_document_source_period_locks" USING btree ("period_lock_id");--> statement-breakpoint
CREATE INDEX "billing_document_trip_claims_document_trip_active_uniq" ON "billing_document_trip_claims" USING btree ("document_id","trip_id") WHERE "billing_document_trip_claims"."released_at" is null;--> statement-breakpoint
CREATE INDEX "billing_document_trip_claims_document_idx" ON "billing_document_trip_claims" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "billing_document_trip_claims_trip_idx" ON "billing_document_trip_claims" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "billing_documents_entity_idx" ON "billing_documents" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "billing_documents_active_period_unique" ON "billing_documents" USING btree ("type","entity_type","entity_id","range_from","range_to") WHERE "billing_documents"."deleted_at" IS NULL AND "billing_documents"."type" = 'DEBIT_NOTE';--> statement-breakpoint
CREATE INDEX "business_calendar_days_date_uniq_idx" ON "business_calendar_days" USING btree ("calendar_date");--> statement-breakpoint
CREATE INDEX "business_units_name_uniq_idx" ON "business_units" USING btree ("name");--> statement-breakpoint
CREATE INDEX "business_units_status_idx" ON "business_units" USING btree ("status");--> statement-breakpoint
CREATE INDEX "credit_override_requests_customer_idx" ON "credit_override_requests" USING btree ("customer_id","status","created_at");--> statement-breakpoint
CREATE INDEX "credit_override_requests_shipment_idx" ON "credit_override_requests" USING btree ("shipment_id","status");--> statement-breakpoint
CREATE INDEX "credit_override_requests_active_shipment_uniq" ON "credit_override_requests" USING btree ("shipment_id") WHERE "credit_override_requests"."shipment_id" is not null and "credit_override_requests"."status" in ('PENDING', 'APPROVED');--> statement-breakpoint
CREATE INDEX "customer_email_logs_customer_idx" ON "customer_email_logs" USING btree ("customer_id","status");--> statement-breakpoint
CREATE INDEX "customer_email_logs_status_idx" ON "customer_email_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "customer_email_logs_visible_event_idx" ON "customer_email_logs" USING btree ("customer_visible_event_id");--> statement-breakpoint
CREATE INDEX "customer_event_ack_actor_kind_uniq" ON "customer_event_acknowledgements" USING btree ("event_id","acknowledged_by","kind");--> statement-breakpoint
CREATE INDEX "customer_event_ack_idempotency_uniq" ON "customer_event_acknowledgements" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "customer_event_ack_customer_idx" ON "customer_event_acknowledgements" USING btree ("customer_id","acknowledged_at");--> statement-breakpoint
CREATE INDEX "customer_visible_events_key_version_uniq" ON "customer_visible_events" USING btree ("event_key","content_version");--> statement-breakpoint
CREATE INDEX "customer_visible_events_supersedes_uniq" ON "customer_visible_events" USING btree ("supersedes_event_id") WHERE "customer_visible_events"."supersedes_event_id" is not null;--> statement-breakpoint
CREATE INDEX "customer_visible_events_shipment_idx" ON "customer_visible_events" USING btree ("shipment_id","occurred_at");--> statement-breakpoint
CREATE INDEX "customer_visible_events_customer_idx" ON "customer_visible_events" USING btree ("customer_id","occurred_at");--> statement-breakpoint
CREATE INDEX "customers_active_name_tax_code_uniq_idx" ON "customers" USING btree (lower(btrim("name")),coalesce(nullif(lower(btrim("tax_code")), ''), '')) WHERE "customers"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "customers_active_tax_code_uniq_idx" ON "customers" USING btree (lower(btrim("tax_code"))) WHERE "customers"."deleted_at" is null and nullif(btrim("customers"."tax_code"), '') is not null;--> statement-breakpoint
CREATE INDEX "customers_partner_idx" ON "customers" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "debt_offsets_customer_idx" ON "debt_offsets" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "debt_offsets_supplier_idx" ON "debt_offsets" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "debt_offsets_partner_idx" ON "debt_offsets" USING btree ("partner_id","offset_date");--> statement-breakpoint
CREATE INDEX "delete_requests_status_idx" ON "delete_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "dispatch_handoffs_shipment_idx" ON "dispatch_handoffs" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "dispatch_handoffs_handler_idx" ON "dispatch_handoffs" USING btree ("handler_id");--> statement-breakpoint
CREATE INDEX "dispatch_handoffs_status_idx" ON "dispatch_handoffs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "dispatch_handoffs_shipment_active_uniq" ON "dispatch_handoffs" USING btree ("shipment_id") WHERE "dispatch_handoffs"."status" IN ('UNSEEN', 'SEEN');--> statement-breakpoint
CREATE INDEX "dispatch_handoffs_supersedes_uniq" ON "dispatch_handoffs" USING btree ("supersedes_handoff_id") WHERE "dispatch_handoffs"."supersedes_handoff_id" is not null;--> statement-breakpoint
CREATE INDEX "driver_incidental_costs_trip_idx" ON "driver_incidental_costs" USING btree ("trip_id","occurred_at");--> statement-breakpoint
CREATE INDEX "driver_incidental_costs_driver_idx" ON "driver_incidental_costs" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "driver_progress_events_trip_idx" ON "driver_progress_events" USING btree ("trip_id","occurred_at");--> statement-breakpoint
CREATE INDEX "driver_progress_events_driver_idx" ON "driver_progress_events" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "driver_work_days_driver_date_idx" ON "driver_work_days" USING btree ("driver_id","date");--> statement-breakpoint
CREATE INDEX "driver_work_days_driver_idx" ON "driver_work_days" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "drivers_active_user_uniq_idx" ON "drivers" USING btree ("user_id") WHERE "drivers"."user_id" is not null and "drivers"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "durable_effect_jobs_kind_dedupe_uniq_idx" ON "durable_effect_jobs" USING btree ("kind","dedupe_key");--> statement-breakpoint
CREATE INDEX "durable_effect_jobs_due_idx" ON "durable_effect_jobs" USING btree ("status","next_attempt_at","id");--> statement-breakpoint
CREATE INDEX "durable_effect_jobs_lease_idx" ON "durable_effect_jobs" USING btree ("status","lease_expires_at");--> statement-breakpoint
CREATE INDEX "expense_photos_storage_key_idx" ON "expense_photos" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "expenses_date_idx" ON "expenses" USING btree ("expense_date");--> statement-breakpoint
CREATE INDEX "expenses_supplier_idx" ON "expenses" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "expenses_category_idx" ON "expenses" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "expenses_vehicle_idx" ON "expenses" USING btree ("truck_id","vehicle_component");--> statement-breakpoint
CREATE INDEX "financial_reporting_policy_versions_effective_from_uniq" ON "financial_reporting_policy_versions" USING btree ("effective_from");--> statement-breakpoint
CREATE INDEX "financial_reporting_policy_versions_governance_action_uniq" ON "financial_reporting_policy_versions" USING btree ("governance_action_id");--> statement-breakpoint
CREATE INDEX "financial_reporting_policy_versions_effective_lookup_idx" ON "financial_reporting_policy_versions" USING btree ("effective_from","created_at");--> statement-breakpoint
CREATE INDEX "fuel_invoice_allocations_invoice_idx" ON "fuel_invoice_allocations" USING btree ("fuel_invoice_id");--> statement-breakpoint
CREATE INDEX "fuel_invoice_allocations_truck_idx" ON "fuel_invoice_allocations" USING btree ("truck_id","voucher_date");--> statement-breakpoint
CREATE INDEX "fuel_invoice_allocations_trip_expense_uniq_idx" ON "fuel_invoice_allocations" USING btree ("trip_expense_id") WHERE "fuel_invoice_allocations"."trip_expense_id" is not null;--> statement-breakpoint
CREATE INDEX "fuel_invoice_allocations_invoice_voucher_uniq_idx" ON "fuel_invoice_allocations" USING btree ("fuel_invoice_id","trip_id","voucher_reference");--> statement-breakpoint
CREATE INDEX "fuel_invoices_supplier_idx" ON "fuel_invoices" USING btree ("supplier_id","invoice_date");--> statement-breakpoint
CREATE INDEX "fuel_invoices_supplier_invoice_uniq_idx" ON "fuel_invoices" USING btree ("supplier_id",lower(btrim("invoice_number")),"invoice_date");--> statement-breakpoint
CREATE INDEX "fuel_norms_route_truck_date_idx" ON "fuel_norms" USING btree ("route_id","truck_id","effective_date");--> statement-breakpoint
CREATE INDEX "fuel_period_adjustments_action_source_uniq" ON "fuel_period_adjustments" USING btree ("governance_action_id","source_period_lock_id");--> statement-breakpoint
CREATE INDEX "fuel_period_adjustments_invoice_idx" ON "fuel_period_adjustments" USING btree ("fuel_invoice_id","created_at");--> statement-breakpoint
CREATE INDEX "fuel_period_adjustments_source_idx" ON "fuel_period_adjustments" USING btree ("source_period","created_at");--> statement-breakpoint
CREATE INDEX "fuel_period_adjustments_target_idx" ON "fuel_period_adjustments" USING btree ("target_period","created_at");--> statement-breakpoint
CREATE INDEX "fuel_recon_explanations_supplier_period_uniq" ON "fuel_recon_explanations" USING btree ("supplier_id","period_from","period_to");--> statement-breakpoint
CREATE INDEX "fuel_recon_explanations_supplier_idx" ON "fuel_recon_explanations" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "fuel_surcharge_customer_active_uniq" ON "fuel_surcharge_configs" USING btree ("customer_id") WHERE "fuel_surcharge_configs"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "governance_actions_subject_idx" ON "governance_actions" USING btree ("subject_type","subject_id","created_at");--> statement-breakpoint
CREATE INDEX "governance_actions_subject_key_idx" ON "governance_actions" USING btree ("subject_type","subject_key","created_at");--> statement-breakpoint
CREATE INDEX "governance_actions_status_idx" ON "governance_actions" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "governance_actions_active_subject_key_uniq" ON "governance_actions" USING btree ("subject_type","subject_key","action_kind","original_version") WHERE "governance_actions"."subject_key" is not null and "governance_actions"."status" in ('PENDING_CHECK', 'PENDING_APPROVAL', 'RETURNED_FOR_EVIDENCE');--> statement-breakpoint
CREATE INDEX "governance_actions_active_subject_id_uniq" ON "governance_actions" USING btree ("subject_type","subject_id","action_kind","original_version") WHERE "governance_actions"."subject_id" is not null and "governance_actions"."action_kind" not in ('TRIP_AR_ADJUSTMENT', 'TRIP_REOPEN') and "governance_actions"."status" in ('PENDING_CHECK', 'PENDING_APPROVAL', 'RETURNED_FOR_EVIDENCE');--> statement-breakpoint
CREATE INDEX "idempotency_keys_endpoint_key_uniq" ON "idempotency_keys" USING btree ("endpoint","idempotency_key");--> statement-breakpoint
CREATE INDEX "idempotency_keys_entity_idx" ON "idempotency_keys" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_source_idx" ON "knowledge_chunks" USING btree ("source_type","source_path");--> statement-breakpoint
CREATE INDEX "ledger_entity_entity_idx" ON "ledger" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "ledger_entity_entity_id_idx" ON "ledger" USING btree ("entity_type","entity_id","id");--> statement-breakpoint
CREATE INDEX "ledger_entity_txn_timestamp_idx" ON "ledger" USING btree ("entity_type","txn_type","timestamp");--> statement-breakpoint
CREATE INDEX "ledger_financial_posting_idx" ON "ledger" USING btree ("financial_posting_id");--> statement-breakpoint
CREATE INDEX "ledger_forwarder_settlement_once_idx" ON "ledger" USING btree ("txn_type","txn_id","entity_type","entity_id") WHERE "ledger"."txn_type" = 'FORWARDER_SETTLEMENT';--> statement-breakpoint
CREATE INDEX "lift_pricing_port_type_state_dir_date_uniq" ON "lift_pricing" USING btree ("port_id","container_type_id","direction","load_state","effective_date");--> statement-breakpoint
CREATE INDEX "master_import_batches_hash_parser_uniq_idx" ON "master_import_batches" USING btree ("source_file_hash","parser_version");--> statement-breakpoint
CREATE INDEX "master_import_rows_batch_sheet_row_uniq_idx" ON "master_import_row_results" USING btree ("batch_id","sheet_name","row_number");--> statement-breakpoint
CREATE INDEX "master_import_rows_batch_class_idx" ON "master_import_row_results" USING btree ("batch_id","classification");--> statement-breakpoint
CREATE INDEX "notifications_user_unread_idx" ON "notifications" USING btree ("user_id","is_read");--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "operational_sites_customer_code_uniq_idx" ON "operational_sites" USING btree ("customer_id","code") WHERE "operational_sites"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "operational_sites_customer_id_id_uniq_idx" ON "operational_sites" USING btree ("customer_id","id");--> statement-breakpoint
CREATE INDEX "operational_sites_customer_type_idx" ON "operational_sites" USING btree ("customer_id","site_type","is_active");--> statement-breakpoint
CREATE INDEX "partners_normalized_tax_code_uniq_idx" ON "partners" USING btree ("normalized_tax_code");--> statement-breakpoint
CREATE INDEX "payment_allocations_customer_idx" ON "payment_allocations" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "payment_allocations_target_idx" ON "payment_allocations" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "payment_allocations_document_idx" ON "payment_allocations" USING btree ("billing_document_id","created_at");--> statement-breakpoint
CREATE INDEX "payment_allocations_source_trip_idx" ON "payment_allocations" USING btree ("source_trip_id","created_at");--> statement-breakpoint
CREATE INDEX "payment_allocations_receipt_idx" ON "payment_allocations" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "payment_allocations_receipt_order_uniq" ON "payment_allocations" USING btree ("payment_receipt_id","allocation_order") WHERE "payment_allocations"."payment_receipt_id" is not null;--> statement-breakpoint
CREATE INDEX "payment_allocations_receipt_target_uniq" ON "payment_allocations" USING btree ("payment_receipt_id","target_type","target_id",coalesce("source_trip_id", 0)) WHERE "payment_allocations"."payment_receipt_id" is not null;--> statement-breakpoint
CREATE INDEX "payment_receipts_receipt_id_uniq" ON "payment_receipts" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "payment_receipts_customer_created_idx" ON "payment_receipts" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "payment_refunds_governance_action_uniq" ON "payment_refunds" USING btree ("governance_action_id");--> statement-breakpoint
CREATE INDEX "payment_refunds_receipt_created_idx" ON "payment_refunds" USING btree ("payment_receipt_id","created_at");--> statement-breakpoint
CREATE INDEX "penalties_date_idx" ON "penalties" USING btree ("date");--> statement-breakpoint
CREATE INDEX "period_locks_domain_scope_period_uniq" ON "period_locks" USING btree ("domain","scope_type","scope_id","period_key");--> statement-breakpoint
CREATE INDEX "period_locks_lookup_idx" ON "period_locks" USING btree ("domain","scope_type","scope_id","status","period_start","period_end");--> statement-breakpoint
CREATE INDEX "photo_geotags_entity_uniq" ON "photo_geotags" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "pricing_tables_general_date_idx" ON "pricing_tables" USING btree ("customer_id","route_id","effective_date") WHERE "pricing_tables"."container_type_id" is null and "pricing_tables"."rate_key" is null;--> statement-breakpoint
CREATE INDEX "pricing_tables_container_date_idx" ON "pricing_tables" USING btree ("customer_id","route_id","container_type_id","effective_date") WHERE "pricing_tables"."container_type_id" is not null and "pricing_tables"."rate_key" is null;--> statement-breakpoint
CREATE INDEX "pricing_tables_rate_key_date_idx" ON "pricing_tables" USING btree ("customer_id","route_id","rate_key","effective_date") WHERE "pricing_tables"."container_type_id" is null and "pricing_tables"."rate_key" is not null;--> statement-breakpoint
CREATE INDEX "profitability_snapshot_dimensions_uniq" ON "profitability_snapshot_dimensions" USING btree ("snapshot_id","dimension");--> statement-breakpoint
CREATE INDEX "profitability_snapshot_dimensions_lookup_idx" ON "profitability_snapshot_dimensions" USING btree ("dimension","dimension_key");--> statement-breakpoint
CREATE INDEX "profitability_snapshots_posting_uniq" ON "profitability_snapshots" USING btree ("financial_posting_id");--> statement-breakpoint
CREATE INDEX "profitability_snapshots_business_date_idx" ON "profitability_snapshots" USING btree ("completed_business_date");--> statement-breakpoint
CREATE INDEX "push_sub_user_endpoint_idx" ON "push_subscriptions" USING btree ("user_id","endpoint");--> statement-breakpoint
CREATE INDEX "push_sub_user_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "road_allowances_route_type_idx" ON "road_allowances" USING btree ("route_id","trailer_type");--> statement-breakpoint
CREATE INDEX "route_polylines_uniq_idx" ON "route_polylines" USING btree ("origin_cleaned","destination_cleaned");--> statement-breakpoint
CREATE INDEX "salary_confirmations_driver_period_idx" ON "salary_confirmations" USING btree ("driver_id","year","month");--> statement-breakpoint
CREATE INDEX "salary_period_adjustments_action_uniq" ON "salary_period_adjustments" USING btree ("governance_action_id");--> statement-breakpoint
CREATE INDEX "salary_period_adjustments_target_driver_idx" ON "salary_period_adjustments" USING btree ("target_period","driver_id","created_at");--> statement-breakpoint
CREATE INDEX "salary_period_adjustments_source_driver_idx" ON "salary_period_adjustments" USING btree ("source_period","driver_id","created_at");--> statement-breakpoint
CREATE INDEX "salary_period_closes_period_uniq" ON "salary_period_closes" USING btree ("period");--> statement-breakpoint
CREATE INDEX "salesperson_assignments_customer_default_active_uniq" ON "salesperson_assignments" USING btree ("customer_id") WHERE "salesperson_assignments"."shipment_id" is null and "salesperson_assignments"."effective_to" is null;--> statement-breakpoint
CREATE INDEX "salesperson_assignments_shipment_active_uniq" ON "salesperson_assignments" USING btree ("shipment_id") WHERE "salesperson_assignments"."shipment_id" is not null and "salesperson_assignments"."effective_to" is null;--> statement-breakpoint
CREATE INDEX "salesperson_assignments_supersedes_uniq" ON "salesperson_assignments" USING btree ("supersedes_assignment_id") WHERE "salesperson_assignments"."supersedes_assignment_id" is not null;--> statement-breakpoint
CREATE INDEX "salesperson_assignments_lookup_idx" ON "salesperson_assignments" USING btree ("customer_id","shipment_id","effective_from");--> statement-breakpoint
CREATE INDEX "scheduler_run_logs_job_started_idx" ON "scheduler_run_logs" USING btree ("job_name","started_at");--> statement-breakpoint
CREATE INDEX "settlement_expense_adjustments_link_sequence_uniq" ON "settlement_expense_adjustments" USING btree ("settlement_expense_id","sequence");--> statement-breakpoint
CREATE INDEX "settlement_expense_adjustments_settlement_idx" ON "settlement_expense_adjustments" USING btree ("settlement_id","adjusted_at");--> statement-breakpoint
CREATE INDEX "settlement_expense_adjustments_expense_idx" ON "settlement_expense_adjustments" USING btree ("trip_expense_id","adjusted_at");--> statement-breakpoint
CREATE INDEX "settlement_expense_unique_idx" ON "settlement_expenses" USING btree ("settlement_id","trip_expense_id");--> statement-breakpoint
CREATE INDEX "settlement_expense_trip_expense_idx" ON "settlement_expenses" USING btree ("trip_expense_id");--> statement-breakpoint
CREATE INDEX "shipment_change_requests_shipment_version_uniq_idx" ON "shipment_change_requests" USING btree ("shipment_id","source_version");--> statement-breakpoint
CREATE INDEX "shipment_change_requests_shipment_created_idx" ON "shipment_change_requests" USING btree ("shipment_id","created_at");--> statement-breakpoint
CREATE INDEX "shipment_containers_shipment_id_idx" ON "shipment_containers" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "shipment_containers_pickup_port_idx" ON "shipment_containers" USING btree ("pickup_port_id");--> statement-breakpoint
CREATE INDEX "shipment_containers_dropoff_port_idx" ON "shipment_containers" USING btree ("dropoff_port_id");--> statement-breakpoint
CREATE INDEX "shipment_containers_shipment_id_id_uniq_idx" ON "shipment_containers" USING btree ("shipment_id","id");--> statement-breakpoint
CREATE INDEX "shipment_declarations_shipment_id_idx" ON "shipment_declarations" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "shipment_documents_shipment_id_idx" ON "shipment_documents" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "shipment_fulfillments_shipment_id_id_uniq_idx" ON "shipment_fulfillments" USING btree ("shipment_id","id");--> statement-breakpoint
CREATE INDEX "shipment_fulfillments_shipment_idx" ON "shipment_fulfillments" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "shipment_fulfillments_active_container_uniq_idx" ON "shipment_fulfillments" USING btree ("shipment_container_id") WHERE "shipment_fulfillments"."shipment_container_id" is not null and "shipment_fulfillments"."canceled_at" is null;--> statement-breakpoint
CREATE INDEX "shipment_fulfillments_active_lcl_uniq_idx" ON "shipment_fulfillments" USING btree ("shipment_id") WHERE "shipment_fulfillments"."fulfillment_type" = 'LCL_SHIPMENT' and "shipment_fulfillments"."canceled_at" is null;--> statement-breakpoint
CREATE INDEX "shipment_fulfillments_replacement_uniq_idx" ON "shipment_fulfillments" USING btree ("replacement_fulfillment_id") WHERE "shipment_fulfillments"."replacement_fulfillment_id" is not null;--> statement-breakpoint
CREATE INDEX "shipment_milestones_shipment_idx" ON "shipment_milestones" USING btree ("shipment_id","occurred_at");--> statement-breakpoint
CREATE INDEX "shipment_milestones_trip_type_uniq" ON "shipment_milestones" USING btree ("shipment_id","trip_id","type") WHERE "shipment_milestones"."trip_id" is not null;--> statement-breakpoint
CREATE INDEX "shipment_status_history_shipment_id_idx" ON "shipment_status_history" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "shipments_id_cargo_mode_uniq_idx" ON "shipments" USING btree ("id","cargo_mode");--> statement-breakpoint
CREATE INDEX "shipments_customer_status_idx" ON "shipments" USING btree ("customer_id","status");--> statement-breakpoint
CREATE INDEX "shipments_route_idx" ON "shipments" USING btree ("route_id");--> statement-breakpoint
CREATE INDEX "shipments_responsible_unit_idx" ON "shipments" USING btree ("responsible_unit_id","status");--> statement-breakpoint
CREATE INDEX "shipments_status_idx" ON "shipments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "shipments_operational_site_idx" ON "shipments" USING btree ("operational_site_id");--> statement-breakpoint
CREATE INDEX "shipments_pickup_warehouse_idx" ON "shipments" USING btree ("pickup_warehouse_site_id");--> statement-breakpoint
CREATE INDEX "suppliers_partner_idx" ON "suppliers" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "tires_truck_id_idx" ON "tires" USING btree ("truck_id");--> statement-breakpoint
CREATE INDEX "tires_trailer_id_idx" ON "tires" USING btree ("trailer_id");--> statement-breakpoint
CREATE INDEX "treasury_accounts_code_uniq" ON "treasury_accounts" USING btree ("code");--> statement-breakpoint
CREATE INDEX "treasury_accounts_type_status_idx" ON "treasury_accounts" USING btree ("type","status");--> statement-breakpoint
CREATE INDEX "treasury_movements_physical_posted_uniq" ON "treasury_movements" USING btree ("treasury_account_id","direction","physical_reference") WHERE "treasury_movements"."status" = 'POSTED';--> statement-breakpoint
CREATE INDEX "treasury_movements_receipt_posted_uniq" ON "treasury_movements" USING btree ("payment_receipt_id") WHERE "treasury_movements"."payment_receipt_id" is not null and "treasury_movements"."status" = 'POSTED' and "treasury_movements"."reversal_of_id" is null;--> statement-breakpoint
CREATE INDEX "treasury_movements_ledger_posted_uniq" ON "treasury_movements" USING btree ("ledger_entry_id") WHERE "treasury_movements"."ledger_entry_id" is not null and "treasury_movements"."status" = 'POSTED' and "treasury_movements"."reversal_of_id" is null;--> statement-breakpoint
CREATE INDEX "treasury_movements_reversal_uniq" ON "treasury_movements" USING btree ("reversal_of_id","source_version") WHERE "treasury_movements"."reversal_of_id" is not null;--> statement-breakpoint
CREATE INDEX "treasury_movements_account_date_idx" ON "treasury_movements" USING btree ("treasury_account_id","value_date");--> statement-breakpoint
CREATE INDEX "trip_container_seals_container_idx" ON "trip_container_seals" USING btree ("trip_container_id");--> statement-breakpoint
CREATE INDEX "trip_containers_trip_id_idx" ON "trip_containers" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "trip_containers_shipment_source_idx" ON "trip_containers" USING btree ("source_shipment_id","source_shipment_container_id");--> statement-breakpoint
CREATE INDEX "trip_expense_scope_container_unq" ON "trip_expense_completion_scopes" USING btree ("trip_container_id") WHERE "trip_expense_completion_scopes"."trip_container_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "trip_expense_scope_general_unq" ON "trip_expense_completion_scopes" USING btree ("trip_id") WHERE "trip_expense_completion_scopes"."trip_container_id" IS NULL;--> statement-breakpoint
CREATE INDEX "trip_expense_scope_trip_idx" ON "trip_expense_completion_scopes" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "trip_expense_photos_storage_key_idx" ON "trip_expense_photos" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "trip_expenses_trip_id_idx" ON "trip_expenses" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "trip_expenses_container_idx" ON "trip_expenses" USING btree ("container_number");--> statement-breakpoint
CREATE INDEX "trip_expenses_trip_container_id_idx" ON "trip_expenses" USING btree ("trip_container_id");--> statement-breakpoint
CREATE INDEX "trip_expenses_lift_pricing_id_idx" ON "trip_expenses" USING btree ("lift_pricing_id");--> statement-breakpoint
CREATE INDEX "trip_expenses_no_invoice_aggregate_idx" ON "trip_expenses" USING btree ("expense_type","expense_date","payee_name");--> statement-breakpoint
CREATE INDEX "trip_financial_postings_trip_version_uniq" ON "trip_financial_postings" USING btree ("trip_id","version");--> statement-breakpoint
CREATE INDEX "trip_financial_postings_trip_active_uniq" ON "trip_financial_postings" USING btree ("trip_id") WHERE "trip_financial_postings"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "trip_financial_postings_supersedes_uniq" ON "trip_financial_postings" USING btree ("supersedes_id") WHERE "trip_financial_postings"."supersedes_id" is not null;--> statement-breakpoint
CREATE INDEX "trip_financial_postings_trip_status_idx" ON "trip_financial_postings" USING btree ("trip_id","status");--> statement-breakpoint
CREATE INDEX "trip_gps_capture_jobs_action_uniq_idx" ON "trip_gps_capture_jobs" USING btree ("governance_action_id");--> statement-breakpoint
CREATE INDEX "trip_gps_capture_jobs_retry_idx" ON "trip_gps_capture_jobs" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "trip_gps_tracks_trip_uniq_idx" ON "trip_gps_tracks" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "trip_gps_tracks_route_idx" ON "trip_gps_tracks" USING btree ("route_id");--> statement-breakpoint
CREATE INDEX "trip_gps_tracks_truck_ended_idx" ON "trip_gps_tracks" USING btree ("truck_id","ended_at");--> statement-breakpoint
CREATE INDEX "trip_instructions_trip_id_unq" ON "trip_instructions" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "trip_pairs_trip_order_uniq_idx" ON "trip_pairs" USING btree ("first_trip_id","second_trip_id");--> statement-breakpoint
CREATE INDEX "trip_pairs_status_idx" ON "trip_pairs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "trip_photos_trip_container_id_idx" ON "trip_photos" USING btree ("trip_container_id");--> statement-breakpoint
CREATE INDEX "trip_pod_files_storage_key_uniq_idx" ON "trip_pod_files" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "trip_pod_files_required_slot_uniq_idx" ON "trip_pod_files" USING btree ("submission_id","file_type") WHERE "trip_pod_files"."file_type" <> 'TOLL_TICKET';--> statement-breakpoint
CREATE INDEX "trip_pod_files_submission_idx" ON "trip_pod_files" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "trip_pod_submissions_trip_id_id_uniq_idx" ON "trip_pod_submissions" USING btree ("trip_id","id");--> statement-breakpoint
CREATE INDEX "trip_pod_submissions_trip_version_uniq_idx" ON "trip_pod_submissions" USING btree ("trip_id","submission_version");--> statement-breakpoint
CREATE INDEX "trip_pod_submissions_supersedes_uniq_idx" ON "trip_pod_submissions" USING btree ("supersedes_submission_id") WHERE "trip_pod_submissions"."supersedes_submission_id" is not null;--> statement-breakpoint
CREATE INDEX "trip_pod_submissions_open_uniq_idx" ON "trip_pod_submissions" USING btree ("trip_id") WHERE "trip_pod_submissions"."status" in ('DRAFT', 'SUBMITTED');--> statement-breakpoint
CREATE INDEX "trip_pod_submissions_accepted_uniq_idx" ON "trip_pod_submissions" USING btree ("trip_id") WHERE "trip_pod_submissions"."status" = 'ACCEPTED';--> statement-breakpoint
CREATE INDEX "trip_pod_submissions_fulfillment_status_idx" ON "trip_pod_submissions" USING btree ("fulfillment_id","status");--> statement-breakpoint
CREATE INDEX "trips_trailer_id_idx" ON "trips" USING btree ("trailer_id");--> statement-breakpoint
CREATE INDEX "trips_status_idx" ON "trips" USING btree ("status");--> statement-breakpoint
CREATE INDEX "trips_departure_date_idx" ON "trips" USING btree ("departure_date");--> statement-breakpoint
CREATE INDEX "trips_customer_departure_idx" ON "trips" USING btree ("customer_id","departure_date");--> statement-breakpoint
CREATE INDEX "trips_active_trip_pair_idx" ON "trips" USING btree ("active_trip_pair_id");--> statement-breakpoint
CREATE INDEX "trips_active_trip_pair_order_uniq" ON "trips" USING btree ("active_trip_pair_id","active_trip_pair_order") WHERE "trips"."active_trip_pair_id" is not null;--> statement-breakpoint
CREATE INDEX "trips_shipment_id_idx" ON "trips" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "trips_fulfillment_id_idx" ON "trips" USING btree ("fulfillment_id");--> statement-breakpoint
CREATE INDEX "trips_id_fulfillment_uniq_idx" ON "trips" USING btree ("id","fulfillment_id");--> statement-breakpoint
CREATE INDEX "trips_fulfillment_id_live_uniq" ON "trips" USING btree ("fulfillment_id") WHERE "trips"."fulfillment_id" is not null and "trips"."status" <> 'CANCELED';--> statement-breakpoint
CREATE INDEX "trips_shipment_without_fulfillment_live_uniq" ON "trips" USING btree ("shipment_id") WHERE "trips"."shipment_id" is not null and "trips"."fulfillment_id" is null and "trips"."status" <> 'CANCELED';--> statement-breakpoint
CREATE INDEX "truck_cap_table_truck_effective_idx" ON "truck_cap_table" USING btree ("truck_id","effective_date");--> statement-breakpoint
CREATE INDEX "truck_financial_profile_versions_truck_month_uniq" ON "truck_financial_profile_versions" USING btree ("truck_id","effective_from");--> statement-breakpoint
CREATE INDEX "truck_financial_profile_versions_governance_action_uniq" ON "truck_financial_profile_versions" USING btree ("governance_action_id");--> statement-breakpoint
CREATE INDEX "truck_financial_profile_versions_lookup_idx" ON "truck_financial_profile_versions" USING btree ("truck_id","effective_from","created_at");--> statement-breakpoint
CREATE INDEX "user_business_unit_links_user_unit_uniq_idx" ON "user_business_unit_links" USING btree ("user_id","business_unit_id");--> statement-breakpoint
CREATE INDEX "user_business_unit_links_user_idx" ON "user_business_unit_links" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_business_unit_links_business_unit_idx" ON "user_business_unit_links" USING btree ("business_unit_id");--> statement-breakpoint
CREATE INDEX "user_customer_links_user_customer_uniq_idx" ON "user_customer_links" USING btree ("user_id","customer_id");--> statement-breakpoint
CREATE INDEX "user_customer_links_user_idx" ON "user_customer_links" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_customer_links_customer_idx" ON "user_customer_links" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "user_shipment_links_user_shipment_uniq_idx" ON "user_shipment_links" USING btree ("user_id","shipment_id");--> statement-breakpoint
CREATE INDEX "user_shipment_links_user_idx" ON "user_shipment_links" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_shipment_links_shipment_idx" ON "user_shipment_links" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "weight_pricing_tiers_route_cargo_date_idx" ON "weight_pricing_tiers" USING btree ("route_id","cargo_type_id","effective_date");
