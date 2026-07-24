CREATE TABLE "forwarder_expense_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "forwarder_expense_types_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "trip_expenses" ALTER COLUMN "expense_type" SET DATA TYPE varchar(50);