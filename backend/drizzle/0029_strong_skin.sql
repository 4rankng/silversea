ALTER TYPE "public"."txn_type" ADD VALUE IF NOT EXISTS 'EXTERNAL_CARRIER_COST';--> statement-breakpoint
CREATE TABLE "debt_offsets" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"supplier_id" integer NOT NULL,
	"amount" numeric(15, 0) NOT NULL,
	"offset_date" date NOT NULL,
	"note" text,
	"approval_status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"created_by" integer,
	"approved_by" integer,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "is_carrier" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "debit_note_mode" varchar(20) DEFAULT 'MONTHLY' NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "linked_supplier_id" integer;--> statement-breakpoint
ALTER TABLE "forwarder_expense_types" ADD COLUMN "default_markup" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "forwarder_expense_types" ADD COLUMN "billing_label" varchar(120);--> statement-breakpoint
ALTER TABLE "forwarder_expense_types" ADD COLUMN "vat_rate" numeric(5, 3) DEFAULT '0.080' NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "linked_customer_id" integer;--> statement-breakpoint
ALTER TABLE "trip_expenses" RENAME COLUMN "amount" TO "buy_amount";--> statement-breakpoint
ALTER TABLE "trip_expenses" ALTER COLUMN "forwarder_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trips" ALTER COLUMN "truck_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trips" ALTER COLUMN "driver_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trip_expenses" ADD COLUMN "sell_amount" numeric(15, 0) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "trip_expenses" ADD COLUMN "settlement_method" varchar(20) DEFAULT 'FORWARDER_ADVANCE' NOT NULL;--> statement-breakpoint
ALTER TABLE "trip_expenses" ADD COLUMN "supplier_id" integer;--> statement-breakpoint
ALTER TABLE "trip_expenses" ADD COLUMN "invoice_number" varchar(50);--> statement-breakpoint
ALTER TABLE "trip_expenses" ADD COLUMN "invoice_date" date;--> statement-breakpoint
ALTER TABLE "trip_expenses" ADD COLUMN "declaration_number" varchar(50);--> statement-breakpoint
ALTER TABLE "trip_expenses" ADD COLUMN "container_number" varchar(20);--> statement-breakpoint
ALTER TABLE "trip_expenses" ADD COLUMN "approval_status" varchar(20) DEFAULT 'APPROVED' NOT NULL;--> statement-breakpoint
ALTER TABLE "trip_expenses" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "vat_rate" numeric(5, 3) DEFAULT '0.000' NOT NULL;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "carrier_type" varchar(20) DEFAULT 'OWN' NOT NULL;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "external_carrier_id" integer;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "external_freight_cost" numeric(15, 0);--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "external_plate_number" varchar(20);--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "external_driver_name" varchar(100);--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "external_driver_phone" varchar(20);--> statement-breakpoint
ALTER TABLE "debt_offsets" ADD CONSTRAINT "debt_offsets_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debt_offsets" ADD CONSTRAINT "debt_offsets_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debt_offsets" ADD CONSTRAINT "debt_offsets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debt_offsets" ADD CONSTRAINT "debt_offsets_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "debt_offsets_customer_idx" ON "debt_offsets" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "debt_offsets_supplier_idx" ON "debt_offsets" USING btree ("supplier_id");--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_linked_supplier_id_suppliers_id_fk" FOREIGN KEY ("linked_supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_linked_customer_id_customers_id_fk" FOREIGN KEY ("linked_customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_external_carrier_id_customers_id_fk" FOREIGN KEY ("external_carrier_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trip_expenses_container_idx" ON "trip_expenses" USING btree ("container_number");
