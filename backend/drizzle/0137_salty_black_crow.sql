CREATE TYPE "public"."shipment_change_request_kind" AS ENUM('PLAN_UPDATE', 'CONTAINER_RECONCILE');--> statement-breakpoint
CREATE TABLE "business_units" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(50),
	"name" varchar(255) NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "business_units_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "shipment_change_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"shipment_id" integer NOT NULL,
	"source_version" integer NOT NULL,
	"request_kind" "shipment_change_request_kind" NOT NULL,
	"requested_by" integer NOT NULL,
	"before_snapshot" jsonb NOT NULL,
	"after_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "user_shipment_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"shipment_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "responsible_unit_id" integer;--> statement-breakpoint
ALTER TABLE "shipment_change_requests" ADD CONSTRAINT "shipment_change_requests_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_change_requests" ADD CONSTRAINT "shipment_change_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_business_unit_links" ADD CONSTRAINT "user_business_unit_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_business_unit_links" ADD CONSTRAINT "user_business_unit_links_business_unit_id_business_units_id_fk" FOREIGN KEY ("business_unit_id") REFERENCES "public"."business_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_shipment_links" ADD CONSTRAINT "user_shipment_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_shipment_links" ADD CONSTRAINT "user_shipment_links_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "business_units_name_uniq_idx" ON "business_units" USING btree ("name");--> statement-breakpoint
CREATE INDEX "business_units_status_idx" ON "business_units" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_change_requests_shipment_version_uniq_idx" ON "shipment_change_requests" USING btree ("shipment_id","source_version");--> statement-breakpoint
CREATE INDEX "shipment_change_requests_shipment_created_idx" ON "shipment_change_requests" USING btree ("shipment_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_business_unit_links_user_unit_uniq_idx" ON "user_business_unit_links" USING btree ("user_id","business_unit_id");--> statement-breakpoint
CREATE INDEX "user_business_unit_links_user_idx" ON "user_business_unit_links" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_business_unit_links_business_unit_idx" ON "user_business_unit_links" USING btree ("business_unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_shipment_links_user_shipment_uniq_idx" ON "user_shipment_links" USING btree ("user_id","shipment_id");--> statement-breakpoint
CREATE INDEX "user_shipment_links_user_idx" ON "user_shipment_links" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_shipment_links_shipment_idx" ON "user_shipment_links" USING btree ("shipment_id");--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_responsible_unit_id_business_units_id_fk" FOREIGN KEY ("responsible_unit_id") REFERENCES "public"."business_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shipments_responsible_unit_idx" ON "shipments" USING btree ("responsible_unit_id","status");