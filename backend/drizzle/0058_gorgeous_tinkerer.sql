CREATE TABLE "ops_expense_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"shipment_id" integer NOT NULL,
	"shipment_container_id" integer,
	"expense_type_code" varchar(50) NOT NULL,
	"amount" numeric(15, 0) NOT NULL,
	"paid_by_id" integer NOT NULL,
	"paid_at" date NOT NULL,
	"note" text,
	"approval_status" text DEFAULT 'PENDING' NOT NULL,
	"approved_by_id" integer,
	"approved_at" timestamp,
	"rejection_reason" text,
	"ops_settlement_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_expense_photos" (
	"id" serial PRIMARY KEY NOT NULL,
	"ops_expense_id" integer NOT NULL,
	"storage_key" text NOT NULL,
	"uploaded_by_id" integer NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_settlements" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(20) NOT NULL,
	"ops_user_id" integer NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"total_amount" numeric(15, 0) NOT NULL,
	"note" text,
	"approved_by_id" integer,
	"approved_at" timestamp,
	"rejection_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "truck_ops_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"truck_id" integer NOT NULL,
	"ops_user_id" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_shipment_pins" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"shipment_id" integer NOT NULL,
	"pinned_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ops_expense_entries_payer_status_idx" ON "ops_expense_entries" USING btree ("paid_by_id","approval_status");--> statement-breakpoint
CREATE INDEX "ops_expense_entries_shipment_idx" ON "ops_expense_entries" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "ops_expense_entries_settlement_idx" ON "ops_expense_entries" USING btree ("ops_settlement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ops_expense_photos_pair_uniq" ON "ops_expense_photos" USING btree ("ops_expense_id","storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "ops_settlements_code_uniq" ON "ops_settlements" USING btree ("code");--> statement-breakpoint
CREATE INDEX "ops_settlements_user_idx" ON "ops_settlements" USING btree ("ops_user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "truck_ops_assignments_active_truck_uniq" ON "truck_ops_assignments" USING btree ("truck_id") WHERE "truck_ops_assignments"."is_active" is true;--> statement-breakpoint
CREATE INDEX "truck_ops_assignments_ops_idx" ON "truck_ops_assignments" USING btree ("ops_user_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "user_shipment_pins_pair_uniq" ON "user_shipment_pins" USING btree ("user_id","shipment_id");--> statement-breakpoint
CREATE INDEX "user_shipment_pins_shipment_idx" ON "user_shipment_pins" USING btree ("shipment_id");