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
	"release_reason" varchar(32),
	CONSTRAINT "billing_document_trip_claims_posting_version_check" CHECK ("billing_document_trip_claims"."financial_posting_version" > 0),
	CONSTRAINT "billing_document_trip_claims_range_check" CHECK ("billing_document_trip_claims"."range_from" <= "billing_document_trip_claims"."range_to"),
	CONSTRAINT "billing_document_trip_claims_release_reason_check" CHECK ("billing_document_trip_claims"."release_reason" is null or "billing_document_trip_claims"."release_reason" in ('SOURCE_REMOVED', 'DOCUMENT_CANCELED', 'DOCUMENT_DELETED')),
	CONSTRAINT "billing_document_trip_claims_release_actor_check" CHECK ("billing_document_trip_claims"."released_by" is null or "billing_document_trip_claims"."released_at" is not null),
	CONSTRAINT "billing_document_trip_claims_release_consistency_check" CHECK (("billing_document_trip_claims"."released_at" is null and "billing_document_trip_claims"."released_by" is null and "billing_document_trip_claims"."release_reason" is null)
      or ("billing_document_trip_claims"."released_at" is not null and "billing_document_trip_claims"."release_reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "billing_document_lines" ADD COLUMN "financial_posting_id" integer;--> statement-breakpoint
ALTER TABLE "billing_document_lines" ADD COLUMN "financial_posting_version" integer;--> statement-breakpoint
ALTER TABLE "billing_document_lines" ADD COLUMN "posting_checksum" varchar(64);--> statement-breakpoint
ALTER TABLE "billing_document_lines" ADD COLUMN "vat_treatment" varchar(20) DEFAULT 'EXEMPT' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_document_lines" ADD COLUMN "vat_rate" numeric(5, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_document_lines" ADD COLUMN "vat_treatment_version" varchar(30) DEFAULT 'VAT-V1' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_document_lines" ADD COLUMN "net_amount" numeric(15, 0) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_document_lines" ADD COLUMN "tax_amount" numeric(15, 0) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_document_lines" ADD COLUMN "gross_amount" numeric(15, 0) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "total_net" numeric(15, 0) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "total_tax" numeric(15, 0) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "total_gross" numeric(15, 0) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "vat_treatment_version" varchar(30) DEFAULT 'VAT-V1' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_document_recoverable_claims" ADD COLUMN "released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_document_recoverable_claims" ADD COLUMN "released_by" integer;--> statement-breakpoint
ALTER TABLE "billing_document_recoverable_claims" ADD COLUMN "release_reason" varchar(32);--> statement-breakpoint
DROP INDEX "billing_document_recoverable_claims_expense_uniq";--> statement-breakpoint
ALTER TABLE "billing_document_recoverable_claims" ADD CONSTRAINT "billing_document_recoverable_claims_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_document_recoverable_claims_expense_active_uniq" ON "billing_document_recoverable_claims" USING btree ("expense_id") WHERE "billing_document_recoverable_claims"."released_at" is null;--> statement-breakpoint
ALTER TABLE "billing_document_recoverable_claims" ADD CONSTRAINT "billing_document_recoverable_claims_release_consistency_check" CHECK (("billing_document_recoverable_claims"."released_at" is null and "billing_document_recoverable_claims"."released_by" is null and "billing_document_recoverable_claims"."release_reason" is null)
      or ("billing_document_recoverable_claims"."released_at" is not null and "billing_document_recoverable_claims"."release_reason" is not null));--> statement-breakpoint
ALTER TABLE "billing_document_trip_claims" ADD CONSTRAINT "billing_document_trip_claims_document_id_billing_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."billing_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_document_trip_claims" ADD CONSTRAINT "billing_document_trip_claims_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_document_trip_claims" ADD CONSTRAINT "billing_document_trip_claims_financial_posting_id_trip_financial_postings_id_fk" FOREIGN KEY ("financial_posting_id") REFERENCES "public"."trip_financial_postings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_document_trip_claims" ADD CONSTRAINT "billing_document_trip_claims_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_document_trip_claims" ADD CONSTRAINT "billing_document_trip_claims_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_document_trip_claims_document_trip_active_uniq" ON "billing_document_trip_claims" USING btree ("document_id","trip_id") WHERE "billing_document_trip_claims"."released_at" is null;--> statement-breakpoint
CREATE INDEX "billing_document_trip_claims_document_idx" ON "billing_document_trip_claims" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "billing_document_trip_claims_trip_idx" ON "billing_document_trip_claims" USING btree ("trip_id");--> statement-breakpoint
ALTER TABLE "billing_document_lines" ADD CONSTRAINT "billing_document_lines_financial_posting_id_trip_financial_postings_id_fk" FOREIGN KEY ("financial_posting_id") REFERENCES "public"."trip_financial_postings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_document_lines" ADD CONSTRAINT "billing_document_lines_trip_posting_check" CHECK (("billing_document_lines"."financial_posting_id" is null
      and "billing_document_lines"."financial_posting_version" is null
      and "billing_document_lines"."posting_checksum" is null) or (
      "billing_document_lines"."source_type" = 'TRIP'
      and "billing_document_lines"."financial_posting_id" is not null
      and "billing_document_lines"."financial_posting_version" is not null
      and "billing_document_lines"."financial_posting_version" > 0
      and "billing_document_lines"."posting_checksum" is not null
    ));--> statement-breakpoint
ALTER TABLE "billing_document_lines" ADD CONSTRAINT "billing_document_lines_vat_treatment_check" CHECK ("billing_document_lines"."vat_treatment" in ('STANDARD', 'ZERO_RATED', 'EXEMPT'));--> statement-breakpoint
ALTER TABLE "billing_document_lines" ADD CONSTRAINT "billing_document_lines_vat_rate_check" CHECK ("billing_document_lines"."vat_rate" in (0, 0.05, 0.08, 0.10));--> statement-breakpoint
ALTER TABLE "billing_document_lines" ADD CONSTRAINT "billing_document_lines_vat_consistency_check" CHECK ("billing_document_lines"."net_amount" >= 0
      and "billing_document_lines"."tax_amount" >= 0
      and "billing_document_lines"."gross_amount" = "billing_document_lines"."net_amount" + "billing_document_lines"."tax_amount"
      and (("billing_document_lines"."vat_treatment" = 'STANDARD' and "billing_document_lines"."vat_rate" > 0)
        or ("billing_document_lines"."vat_treatment" <> 'STANDARD' and "billing_document_lines"."vat_rate" = 0)));
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "billing_document_trip_claims"
	ADD CONSTRAINT "billing_document_trip_claims_active_overlap_excl"
	EXCLUDE USING gist (
		"trip_id" WITH =,
		daterange("range_from", "range_to", '[]') WITH &&
	)
	WHERE ("released_at" is null);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "release_billing_document_trip_claims"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
		UPDATE billing_document_trip_claims
		SET released_at = COALESCE(released_at, NEW.updated_at, now()),
		    release_reason = COALESCE(release_reason, 'DOCUMENT_DELETED')
		WHERE document_id = NEW.id AND released_at IS NULL;
		UPDATE billing_document_recoverable_claims
		SET released_at = COALESCE(released_at, NEW.updated_at, now()),
		    release_reason = COALESCE(release_reason, 'DOCUMENT_DELETED')
		WHERE document_id = NEW.id AND released_at IS NULL;
	ELSIF COALESCE(OLD.debit_note_status, 'DRAFT') <> 'CANCELED'
	  AND NEW.debit_note_status = 'CANCELED' THEN
		UPDATE billing_document_trip_claims
		SET released_at = COALESCE(released_at, NEW.updated_at, now()),
		    release_reason = COALESCE(release_reason, 'DOCUMENT_CANCELED')
		WHERE document_id = NEW.id AND released_at IS NULL;
		UPDATE billing_document_recoverable_claims
		SET released_at = COALESCE(released_at, NEW.updated_at, now()),
		    release_reason = COALESCE(release_reason, 'DOCUMENT_CANCELED')
		WHERE document_id = NEW.id AND released_at IS NULL;
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "billing_document_trip_claims_release_trg"
AFTER UPDATE OF "debit_note_status", "deleted_at", "updated_at" ON "billing_documents"
FOR EACH ROW EXECUTE FUNCTION "release_billing_document_trip_claims"();
