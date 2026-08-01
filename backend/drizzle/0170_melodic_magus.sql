CREATE TYPE "public"."fulfillment_cancellation_disposition" AS ENUM('REPLACED', 'NOT_REQUIRED');--> statement-breakpoint
CREATE TYPE "public"."master_import_row_classification" AS ENUM('ACCEPTED', 'BLOCKED', 'TEMPLATE', 'EXAMPLE');--> statement-breakpoint
CREATE TYPE "public"."master_import_status" AS ENUM('ANALYZED', 'APPLIED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."operational_site_type" AS ENUM('FACTORY', 'WAREHOUSE');--> statement-breakpoint
CREATE TYPE "public"."shipment_fulfillment_type" AS ENUM('FCL_CONTAINER', 'LCL_SHIPMENT');--> statement-breakpoint
CREATE TYPE "public"."trip_pod_file_type" AS ENUM('YARD_OR_DROP_RECEIPT', 'SIGNED_DELIVERY_NOTE', 'TOLL_TICKET');--> statement-breakpoint
CREATE TYPE "public"."trip_pod_status" AS ENUM('DRAFT', 'SUBMITTED', 'ACCEPTED', 'REJECTED');--> statement-breakpoint
ALTER TYPE "public"."driver_progress_event_type" ADD VALUE 'PICKED_UP';--> statement-breakpoint
ALTER TYPE "public"."driver_progress_event_type" ADD VALUE 'LOADING_OR_RETURNING';--> statement-breakpoint
ALTER TYPE "public"."driver_progress_event_type" ADD VALUE 'DELIVERED';--> statement-breakpoint
CREATE TABLE "master_import_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_file_name" varchar(255) NOT NULL,
	"source_file_hash" varchar(64) NOT NULL,
	"parser_version" varchar(40) NOT NULL,
	"private_storage_key" varchar(255),
	"status" "master_import_status" DEFAULT 'ANALYZED' NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"warning_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"analyzed_by" integer NOT NULL,
	"applied_by" integer,
	"analyzed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone,
	CONSTRAINT "master_import_batches_hash_check" CHECK (length("master_import_batches"."source_file_hash") = 64),
	CONSTRAINT "master_import_batches_version_positive_check" CHECK ("master_import_batches"."version" > 0),
	CONSTRAINT "master_import_batches_apply_attribution_check" CHECK (("master_import_batches"."status" = 'APPLIED' and "master_import_batches"."applied_by" is not null and "master_import_batches"."applied_at" is not null)
      or ("master_import_batches"."status" <> 'APPLIED' and "master_import_batches"."applied_by" is null and "master_import_batches"."applied_at" is null))
);
--> statement-breakpoint
CREATE TABLE "master_import_row_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_id" integer NOT NULL,
	"sheet_name" varchar(160) NOT NULL,
	"row_number" integer NOT NULL,
	"entity_type" varchar(80) NOT NULL,
	"classification" "master_import_row_classification" NOT NULL,
	"natural_key_hash" varchar(64),
	"payload_hash" varchar(64),
	"reason_code" varchar(80),
	"redacted_reason" text,
	"applied_entity_type" varchar(80),
	"applied_entity_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "master_import_rows_row_positive_check" CHECK ("master_import_row_results"."row_number" > 0),
	CONSTRAINT "master_import_rows_reason_check" CHECK ("master_import_row_results"."classification" <> 'BLOCKED' or ("master_import_row_results"."reason_code" is not null and "master_import_row_results"."redacted_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "operational_sites" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"code" varchar(80) NOT NULL,
	"name" varchar(255) NOT NULL,
	"site_type" "operational_site_type" NOT NULL,
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
	"deleted_at" timestamp with time zone,
	CONSTRAINT "operational_sites_code_not_blank_check" CHECK (length(btrim("operational_sites"."code")) > 0),
	CONSTRAINT "operational_sites_name_not_blank_check" CHECK (length(btrim("operational_sites"."name")) > 0),
	CONSTRAINT "operational_sites_address_not_blank_check" CHECK (length(btrim("operational_sites"."address")) > 0),
	CONSTRAINT "operational_sites_version_positive_check" CHECK ("operational_sites"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "shipment_fulfillments" (
	"id" serial PRIMARY KEY NOT NULL,
	"shipment_id" integer NOT NULL,
	"fulfillment_type" "shipment_fulfillment_type" NOT NULL,
	"cargo_mode" "shipment_cargo_mode" NOT NULL,
	"shipment_container_id" integer,
	"source_shipment_version" integer NOT NULL,
	"site_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"canceled_at" timestamp with time zone,
	"canceled_by" integer,
	"cancellation_reason" text,
	"cancellation_disposition" "fulfillment_cancellation_disposition",
	"replacement_fulfillment_id" integer,
	"not_required_approved_by" integer,
	"not_required_approved_at" timestamp with time zone,
	"not_required_reason" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipment_fulfillments_type_container_check" CHECK (("shipment_fulfillments"."cargo_mode" = 'FCL' and "shipment_fulfillments"."fulfillment_type" = 'FCL_CONTAINER'
          and "shipment_fulfillments"."shipment_container_id" is not null)
      or ("shipment_fulfillments"."cargo_mode" = 'LCL' and "shipment_fulfillments"."fulfillment_type" = 'LCL_SHIPMENT'
          and "shipment_fulfillments"."shipment_container_id" is null)),
	CONSTRAINT "shipment_fulfillments_source_version_check" CHECK ("shipment_fulfillments"."source_shipment_version" > 0),
	CONSTRAINT "shipment_fulfillments_version_check" CHECK ("shipment_fulfillments"."version" > 0),
	CONSTRAINT "shipment_fulfillments_cancel_attribution_check" CHECK (("shipment_fulfillments"."canceled_at" is null and "shipment_fulfillments"."canceled_by" is null and "shipment_fulfillments"."cancellation_reason" is null
          and "shipment_fulfillments"."cancellation_disposition" is null and "shipment_fulfillments"."replacement_fulfillment_id" is null
          and "shipment_fulfillments"."not_required_approved_by" is null and "shipment_fulfillments"."not_required_approved_at" is null
          and "shipment_fulfillments"."not_required_reason" is null)
      or ("shipment_fulfillments"."canceled_at" is not null and "shipment_fulfillments"."canceled_by" is not null
          and length(btrim("shipment_fulfillments"."cancellation_reason")) > 0)),
	CONSTRAINT "shipment_fulfillments_disposition_check" CHECK ("shipment_fulfillments"."cancellation_disposition" is null
      or ("shipment_fulfillments"."cancellation_disposition" = 'REPLACED' and "shipment_fulfillments"."replacement_fulfillment_id" is not null
          and "shipment_fulfillments"."not_required_approved_by" is null and "shipment_fulfillments"."not_required_approved_at" is null
          and "shipment_fulfillments"."not_required_reason" is null)
      or ("shipment_fulfillments"."cancellation_disposition" = 'NOT_REQUIRED' and "shipment_fulfillments"."replacement_fulfillment_id" is null
          and "shipment_fulfillments"."not_required_approved_by" is not null and "shipment_fulfillments"."not_required_approved_at" is not null
          and length(btrim("shipment_fulfillments"."not_required_reason")) > 0)),
	CONSTRAINT "shipment_fulfillments_replacement_not_self_check" CHECK ("shipment_fulfillments"."replacement_fulfillment_id" is null or "shipment_fulfillments"."replacement_fulfillment_id" <> "shipment_fulfillments"."id")
);
--> statement-breakpoint
CREATE TABLE "trip_pod_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"submission_id" integer NOT NULL,
	"file_type" "trip_pod_file_type" NOT NULL,
	"storage_key" varchar(255) NOT NULL,
	"original_file_name" varchar(255) NOT NULL,
	"mime_type" varchar(120) NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"uploaded_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_pod_files_size_positive_check" CHECK ("trip_pod_files"."size_bytes" > 0),
	CONSTRAINT "trip_pod_files_sha256_check" CHECK (length("trip_pod_files"."sha256") = 64)
);
--> statement-breakpoint
CREATE TABLE "trip_pod_submissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"trip_id" integer NOT NULL,
	"fulfillment_id" integer NOT NULL,
	"submission_version" integer NOT NULL,
	"source_trip_version" integer NOT NULL,
	"status" "trip_pod_status" DEFAULT 'DRAFT' NOT NULL,
	"supersedes_submission_id" integer,
	"submitted_by" integer,
	"submitted_at" timestamp with time zone,
	"reviewed_by" integer,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_pod_submissions_submission_version_check" CHECK ("trip_pod_submissions"."submission_version" > 0),
	CONSTRAINT "trip_pod_submissions_source_trip_version_check" CHECK ("trip_pod_submissions"."source_trip_version" > 0),
	CONSTRAINT "trip_pod_submissions_version_check" CHECK ("trip_pod_submissions"."version" > 0),
	CONSTRAINT "trip_pod_submissions_state_check" CHECK (("trip_pod_submissions"."status" = 'DRAFT' and "trip_pod_submissions"."submitted_by" is null and "trip_pod_submissions"."submitted_at" is null
          and "trip_pod_submissions"."reviewed_by" is null and "trip_pod_submissions"."reviewed_at" is null and "trip_pod_submissions"."rejection_reason" is null)
      or ("trip_pod_submissions"."status" = 'SUBMITTED' and "trip_pod_submissions"."submitted_by" is not null and "trip_pod_submissions"."submitted_at" is not null
          and "trip_pod_submissions"."reviewed_by" is null and "trip_pod_submissions"."reviewed_at" is null and "trip_pod_submissions"."rejection_reason" is null)
      or ("trip_pod_submissions"."status" = 'ACCEPTED' and "trip_pod_submissions"."submitted_by" is not null and "trip_pod_submissions"."submitted_at" is not null
          and "trip_pod_submissions"."reviewed_by" is not null and "trip_pod_submissions"."reviewed_at" is not null and "trip_pod_submissions"."rejection_reason" is null)
      or ("trip_pod_submissions"."status" = 'REJECTED' and "trip_pod_submissions"."submitted_by" is not null and "trip_pod_submissions"."submitted_at" is not null
          and "trip_pod_submissions"."reviewed_by" is not null and "trip_pod_submissions"."reviewed_at" is not null
          and length(btrim("trip_pod_submissions"."rejection_reason")) > 0)),
	CONSTRAINT "trip_pod_submissions_supersession_check" CHECK (("trip_pod_submissions"."submission_version" = 1 and "trip_pod_submissions"."supersedes_submission_id" is null)
      or ("trip_pod_submissions"."submission_version" > 1 and "trip_pod_submissions"."supersedes_submission_id" is not null))
);
--> statement-breakpoint
DROP INDEX "trips_shipment_id_live_uniq";--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "operational_site_id" integer;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "pickup_warehouse_site_id" integer;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "fulfillment_id" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "operational_sites_customer_id_id_uniq_idx" ON "operational_sites" USING btree ("customer_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_containers_shipment_id_id_uniq_idx" ON "shipment_containers" USING btree ("shipment_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_id_cargo_mode_uniq_idx" ON "shipments" USING btree ("id","cargo_mode");--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_fulfillments_shipment_id_id_uniq_idx" ON "shipment_fulfillments" USING btree ("shipment_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "trips_id_fulfillment_uniq_idx" ON "trips" USING btree ("id","fulfillment_id");--> statement-breakpoint
ALTER TABLE "master_import_batches" ADD CONSTRAINT "master_import_batches_analyzed_by_users_id_fk" FOREIGN KEY ("analyzed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "master_import_batches" ADD CONSTRAINT "master_import_batches_applied_by_users_id_fk" FOREIGN KEY ("applied_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "master_import_row_results" ADD CONSTRAINT "master_import_row_results_batch_id_master_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."master_import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_sites" ADD CONSTRAINT "operational_sites_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_sites" ADD CONSTRAINT "operational_sites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_sites" ADD CONSTRAINT "operational_sites_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_fulfillments" ADD CONSTRAINT "shipment_fulfillments_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_fulfillments" ADD CONSTRAINT "shipment_fulfillments_shipment_container_id_shipment_containers_id_fk" FOREIGN KEY ("shipment_container_id") REFERENCES "public"."shipment_containers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_fulfillments" ADD CONSTRAINT "shipment_fulfillments_canceled_by_users_id_fk" FOREIGN KEY ("canceled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_fulfillments" ADD CONSTRAINT "shipment_fulfillments_not_required_approved_by_users_id_fk" FOREIGN KEY ("not_required_approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_fulfillments" ADD CONSTRAINT "shipment_fulfillments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_fulfillments" ADD CONSTRAINT "shipment_fulfillments_shipment_cargo_mode_fk" FOREIGN KEY ("shipment_id","cargo_mode") REFERENCES "public"."shipments"("id","cargo_mode") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_fulfillments" ADD CONSTRAINT "shipment_fulfillments_shipment_container_fk" FOREIGN KEY ("shipment_id","shipment_container_id") REFERENCES "public"."shipment_containers"("shipment_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_fulfillments" ADD CONSTRAINT "shipment_fulfillments_shipment_replacement_fk" FOREIGN KEY ("shipment_id","replacement_fulfillment_id") REFERENCES "public"."shipment_fulfillments"("shipment_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_pod_files" ADD CONSTRAINT "trip_pod_files_submission_id_trip_pod_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."trip_pod_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_pod_files" ADD CONSTRAINT "trip_pod_files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_pod_submissions" ADD CONSTRAINT "trip_pod_submissions_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_pod_submissions" ADD CONSTRAINT "trip_pod_submissions_fulfillment_id_shipment_fulfillments_id_fk" FOREIGN KEY ("fulfillment_id") REFERENCES "public"."shipment_fulfillments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_pod_submissions" ADD CONSTRAINT "trip_pod_submissions_supersedes_submission_id_trip_pod_submissions_id_fk" FOREIGN KEY ("supersedes_submission_id") REFERENCES "public"."trip_pod_submissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_pod_submissions" ADD CONSTRAINT "trip_pod_submissions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_pod_submissions" ADD CONSTRAINT "trip_pod_submissions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_pod_submissions" ADD CONSTRAINT "trip_pod_submissions_trip_fulfillment_fk" FOREIGN KEY ("trip_id","fulfillment_id") REFERENCES "public"."trips"("id","fulfillment_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "master_import_batches_hash_parser_uniq_idx" ON "master_import_batches" USING btree ("source_file_hash","parser_version");--> statement-breakpoint
CREATE UNIQUE INDEX "master_import_rows_batch_sheet_row_uniq_idx" ON "master_import_row_results" USING btree ("batch_id","sheet_name","row_number");--> statement-breakpoint
CREATE INDEX "master_import_rows_batch_class_idx" ON "master_import_row_results" USING btree ("batch_id","classification");--> statement-breakpoint
CREATE UNIQUE INDEX "operational_sites_customer_code_uniq_idx" ON "operational_sites" USING btree ("customer_id","code") WHERE "operational_sites"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "operational_sites_customer_type_idx" ON "operational_sites" USING btree ("customer_id","site_type","is_active");--> statement-breakpoint
CREATE INDEX "shipment_fulfillments_shipment_idx" ON "shipment_fulfillments" USING btree ("shipment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_fulfillments_active_container_uniq_idx" ON "shipment_fulfillments" USING btree ("shipment_container_id") WHERE "shipment_fulfillments"."shipment_container_id" is not null and "shipment_fulfillments"."canceled_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_fulfillments_active_lcl_uniq_idx" ON "shipment_fulfillments" USING btree ("shipment_id") WHERE "shipment_fulfillments"."fulfillment_type" = 'LCL_SHIPMENT' and "shipment_fulfillments"."canceled_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_fulfillments_replacement_uniq_idx" ON "shipment_fulfillments" USING btree ("replacement_fulfillment_id") WHERE "shipment_fulfillments"."replacement_fulfillment_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "trip_pod_files_storage_key_uniq_idx" ON "trip_pod_files" USING btree ("storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_pod_files_required_slot_uniq_idx" ON "trip_pod_files" USING btree ("submission_id","file_type") WHERE "trip_pod_files"."file_type" <> 'TOLL_TICKET';--> statement-breakpoint
CREATE INDEX "trip_pod_files_submission_idx" ON "trip_pod_files" USING btree ("submission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_pod_submissions_trip_version_uniq_idx" ON "trip_pod_submissions" USING btree ("trip_id","submission_version");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_pod_submissions_supersedes_uniq_idx" ON "trip_pod_submissions" USING btree ("supersedes_submission_id") WHERE "trip_pod_submissions"."supersedes_submission_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "trip_pod_submissions_open_uniq_idx" ON "trip_pod_submissions" USING btree ("trip_id") WHERE "trip_pod_submissions"."status" in ('DRAFT', 'SUBMITTED');--> statement-breakpoint
CREATE UNIQUE INDEX "trip_pod_submissions_accepted_uniq_idx" ON "trip_pod_submissions" USING btree ("trip_id") WHERE "trip_pod_submissions"."status" = 'ACCEPTED';--> statement-breakpoint
CREATE INDEX "trip_pod_submissions_fulfillment_status_idx" ON "trip_pod_submissions" USING btree ("fulfillment_id","status");--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_operational_site_id_operational_sites_id_fk" FOREIGN KEY ("operational_site_id") REFERENCES "public"."operational_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_pickup_warehouse_site_id_operational_sites_id_fk" FOREIGN KEY ("pickup_warehouse_site_id") REFERENCES "public"."operational_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_customer_operational_site_fk" FOREIGN KEY ("customer_id","operational_site_id") REFERENCES "public"."operational_sites"("customer_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_customer_pickup_warehouse_fk" FOREIGN KEY ("customer_id","pickup_warehouse_site_id") REFERENCES "public"."operational_sites"("customer_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_shipment_fulfillment_fk" FOREIGN KEY ("shipment_id","fulfillment_id") REFERENCES "public"."shipment_fulfillments"("shipment_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "drivers"
    WHERE "user_id" IS NOT NULL AND "deleted_at" IS NULL
    GROUP BY "user_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate active driver-to-user bindings must be resolved before applying migration 0170';
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "drivers_active_user_uniq_idx" ON "drivers" USING btree ("user_id") WHERE "drivers"."user_id" is not null and "drivers"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "shipments_operational_site_idx" ON "shipments" USING btree ("operational_site_id");--> statement-breakpoint
CREATE INDEX "shipments_pickup_warehouse_idx" ON "shipments" USING btree ("pickup_warehouse_site_id");--> statement-breakpoint
CREATE INDEX "trips_fulfillment_id_idx" ON "trips" USING btree ("fulfillment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trips_fulfillment_id_live_uniq" ON "trips" USING btree ("fulfillment_id") WHERE "trips"."fulfillment_id" is not null and "trips"."status" <> 'CANCELED';--> statement-breakpoint
CREATE UNIQUE INDEX "trips_shipment_without_fulfillment_live_uniq" ON "trips" USING btree ("shipment_id") WHERE "trips"."shipment_id" is not null and "trips"."fulfillment_id" is null and "trips"."status" <> 'CANCELED';--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_shipment_fulfillment_presence_check" CHECK ("trips"."fulfillment_id" is null or "trips"."shipment_id" is not null);
