CREATE TABLE "shipment_container_charge_facts" (
	"id" serial PRIMARY KEY NOT NULL,
	"shipment_id" integer NOT NULL,
	"shipment_container_id" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"outbound_transport_amount" numeric(15, 0),
	"outbound_handling_amount" numeric(15, 0),
	"outbound_incidental_amount" numeric(15, 0),
	"inbound_transport_amount" numeric(15, 0),
	"inbound_handling_amount" numeric(15, 0),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_document_custody_facts" (
	"id" serial PRIMARY KEY NOT NULL,
	"shipment_id" integer NOT NULL,
	"shipment_version" integer NOT NULL,
	"status" varchar(40) NOT NULL,
	"note" text,
	"changed_by" integer NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_recovery_facts" (
	"id" serial PRIMARY KEY NOT NULL,
	"shipment_id" integer NOT NULL,
	"shipment_container_id" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"kind" varchar(20) NOT NULL,
	"status" varchar(20) DEFAULT 'OPEN' NOT NULL,
	"expected_amount" numeric(15, 0) DEFAULT '0' NOT NULL,
	"recovered_amount" numeric(15, 0) DEFAULT '0' NOT NULL,
	"outstanding_amount" numeric(15, 0) DEFAULT '0' NOT NULL,
	"source_expense_id" integer,
	"source_version" varchar(120),
	"waiver_reason" text,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "shipment_accounting_locks_shipment_uniq_idx";--> statement-breakpoint
ALTER TABLE "shipment_accounting_locks" ADD COLUMN "confirmation_action_id" integer;--> statement-breakpoint
ALTER TABLE "shipment_accounting_locks" ADD COLUMN "released_by" integer;--> statement-breakpoint
ALTER TABLE "shipment_accounting_locks" ADD COLUMN "released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shipment_accounting_locks" ADD COLUMN "release_governance_action_id" integer;--> statement-breakpoint
ALTER TABLE "shipment_accounting_locks" ADD COLUMN "release_reason" text;--> statement-breakpoint
ALTER TABLE "shipment_fulfillments" ADD COLUMN "planned_external_carrier_vehicle_id" integer;--> statement-breakpoint
ALTER TABLE "shipment_fulfillments" ADD COLUMN "planned_vehicle_plate_number" varchar(20);--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_container_charge_facts_container_uniq_idx" ON "shipment_container_charge_facts" USING btree ("shipment_container_id");--> statement-breakpoint
CREATE INDEX "shipment_container_charge_facts_shipment_idx" ON "shipment_container_charge_facts" USING btree ("shipment_id","shipment_container_id");--> statement-breakpoint
CREATE INDEX "shipment_document_custody_facts_shipment_idx" ON "shipment_document_custody_facts" USING btree ("shipment_id","changed_at");--> statement-breakpoint
CREATE INDEX "shipment_recovery_facts_shipment_idx" ON "shipment_recovery_facts" USING btree ("shipment_id","kind","status");--> statement-breakpoint
CREATE INDEX "shipment_recovery_facts_container_idx" ON "shipment_recovery_facts" USING btree ("shipment_container_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_recovery_facts_source_expense_uniq_idx" ON "shipment_recovery_facts" USING btree ("source_expense_id") WHERE "shipment_recovery_facts"."source_expense_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_accounting_locks_active_shipment_uniq_idx" ON "shipment_accounting_locks" USING btree ("shipment_id") WHERE "shipment_accounting_locks"."released_at" is null;--> statement-breakpoint
CREATE INDEX "shipment_accounting_locks_confirmation_idx" ON "shipment_accounting_locks" USING btree ("confirmation_action_id");--> statement-breakpoint
CREATE INDEX "shipment_accounting_locks_release_governance_idx" ON "shipment_accounting_locks" USING btree ("release_governance_action_id");--> statement-breakpoint
CREATE INDEX "shipment_fulfillments_planned_external_carrier_vehicle_idx" ON "shipment_fulfillments" USING btree ("planned_external_carrier_vehicle_id");--> statement-breakpoint
