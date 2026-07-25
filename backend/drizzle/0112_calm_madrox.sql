CREATE TYPE "public"."shipment_declaration_scope" AS ENUM('SINGLE', 'SHARED');--> statement-breakpoint
CREATE TYPE "public"."shipment_document_type" AS ENUM('BOOKING', 'BL', 'DO', 'DECLARATION', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."shipment_status" AS ENUM('DRAFT', 'IN_PROGRESS', 'DELIVERED', 'CLOSED', 'CANCELED');--> statement-breakpoint
CREATE TABLE "shipment_containers" (
	"id" serial PRIMARY KEY NOT NULL,
	"shipment_id" integer NOT NULL,
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
CREATE TABLE "shipment_declarations" (
	"id" serial PRIMARY KEY NOT NULL,
	"shipment_id" integer NOT NULL,
	"declaration_number" varchar(50),
	"issued_at" timestamp with time zone,
	"scope" "shipment_declaration_scope" DEFAULT 'SINGLE',
	"note" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"shipment_id" integer NOT NULL,
	"type" "shipment_document_type",
	"storage_key" varchar(255) NOT NULL,
	"uploaded_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_status_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"shipment_id" integer NOT NULL,
	"from_status" "shipment_status",
	"to_status" "shipment_status" NOT NULL,
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
	"status" "shipment_status" DEFAULT 'DRAFT',
	"booking_ref" varchar(100),
	"bl_number" varchar(100),
	"expected_delivery_date" date,
	"pickup_location" varchar(255),
	"delivery_location" varchar(255),
	"contact_name" varchar(100),
	"contact_phone" varchar(20),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "shipments_shipment_code_unique" UNIQUE("shipment_code")
);
--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "shipment_id" integer;--> statement-breakpoint
ALTER TABLE "shipment_containers" ADD CONSTRAINT "shipment_containers_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_containers" ADD CONSTRAINT "shipment_containers_container_type_id_container_types_id_fk" FOREIGN KEY ("container_type_id") REFERENCES "public"."container_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_containers" ADD CONSTRAINT "shipment_containers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_declarations" ADD CONSTRAINT "shipment_declarations_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_declarations" ADD CONSTRAINT "shipment_declarations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_documents" ADD CONSTRAINT "shipment_documents_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_documents" ADD CONSTRAINT "shipment_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_status_history" ADD CONSTRAINT "shipment_status_history_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_status_history" ADD CONSTRAINT "shipment_status_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shipment_containers_shipment_id_idx" ON "shipment_containers" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "shipment_declarations_shipment_id_idx" ON "shipment_declarations" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "shipment_documents_shipment_id_idx" ON "shipment_documents" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "shipment_status_history_shipment_id_idx" ON "shipment_status_history" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "shipments_customer_status_idx" ON "shipments" USING btree ("customer_id","status");--> statement-breakpoint
CREATE INDEX "shipments_status_idx" ON "shipments" USING btree ("status");--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trips_shipment_id_idx" ON "trips" USING btree ("shipment_id");