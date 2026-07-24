CREATE TYPE "public"."advance_request_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."advance_settlement_status" AS ENUM('PENDING', 'CHECKED_BY_ACCOUNTANT', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."forwarder_expense_type" AS ENUM('LIFTING', 'CUSTOMS', 'WEIGHING', 'INSPECTION', 'OTHER');--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'FORWARDER';--> statement-breakpoint
ALTER TYPE "public"."txn_type" ADD VALUE IF NOT EXISTS 'FORWARDER_ADVANCE';--> statement-breakpoint
ALTER TYPE "public"."txn_type" ADD VALUE IF NOT EXISTS 'FORWARDER_SETTLEMENT';--> statement-breakpoint
CREATE TABLE "advance_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"requester_id" integer NOT NULL,
	"amount" numeric(15, 0) NOT NULL,
	"reason" text NOT NULL,
	"status" "advance_request_status" DEFAULT 'PENDING' NOT NULL,
	"approved_by" integer,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "advance_settlement_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"settlement_id" integer NOT NULL,
	"advance_request_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "advance_settlements" (
	"id" serial PRIMARY KEY NOT NULL,
	"forwarder_id" integer NOT NULL,
	"total_expense_amount" numeric(15, 0) NOT NULL,
	"refund_amount" numeric(15, 0) DEFAULT '0' NOT NULL,
	"status" "advance_settlement_status" DEFAULT 'PENDING' NOT NULL,
	"checked_by" integer,
	"checked_at" timestamp,
	"approved_by" integer,
	"approved_at" timestamp,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_containers" (
	"id" serial PRIMARY KEY NOT NULL,
	"trip_id" integer NOT NULL,
	"container_number" varchar(50) NOT NULL,
	"seal_number" varchar(50),
	"notes" text,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"trip_id" integer NOT NULL,
	"forwarder_id" integer NOT NULL,
	"expense_type" "forwarder_expense_type" NOT NULL,
	"amount" numeric(15, 0) NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "advance_requests" ADD CONSTRAINT "advance_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advance_requests" ADD CONSTRAINT "advance_requests_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advance_settlement_requests" ADD CONSTRAINT "advance_settlement_requests_settlement_id_advance_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."advance_settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advance_settlement_requests" ADD CONSTRAINT "advance_settlement_requests_advance_request_id_advance_requests_id_fk" FOREIGN KEY ("advance_request_id") REFERENCES "public"."advance_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advance_settlements" ADD CONSTRAINT "advance_settlements_forwarder_id_users_id_fk" FOREIGN KEY ("forwarder_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advance_settlements" ADD CONSTRAINT "advance_settlements_checked_by_users_id_fk" FOREIGN KEY ("checked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advance_settlements" ADD CONSTRAINT "advance_settlements_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_containers" ADD CONSTRAINT "trip_containers_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_containers" ADD CONSTRAINT "trip_containers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_forwarder_id_users_id_fk" FOREIGN KEY ("forwarder_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "adv_settlement_req_unique_idx" ON "advance_settlement_requests" USING btree ("settlement_id","advance_request_id");--> statement-breakpoint
CREATE INDEX "trip_containers_trip_id_idx" ON "trip_containers" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "trip_expenses_trip_id_idx" ON "trip_expenses" USING btree ("trip_id");
