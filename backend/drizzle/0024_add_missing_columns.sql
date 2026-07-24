-- Add missing columns to trips table
ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS "two_point_delivery_bonus" numeric(15, 0) DEFAULT '0';
ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS "vehicle_shift_allowance" numeric(15, 0) DEFAULT '0';

-- Create forwarder_expense_types config table
CREATE TABLE IF NOT EXISTS "forwarder_expense_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "forwarder_expense_types_code_unique" UNIQUE("code")
);

-- Change trip_expenses.expense_type from enum to varchar
ALTER TABLE "trip_expenses" ALTER COLUMN "expense_type" SET DATA TYPE varchar(50);
