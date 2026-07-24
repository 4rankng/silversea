CREATE TABLE "trip_expense_photos" (
	"id" serial PRIMARY KEY NOT NULL,
	"trip_expense_id" integer NOT NULL,
	"storage_key" varchar(255) NOT NULL,
	"uploaded_by" integer,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trip_expense_photos" ADD CONSTRAINT "trip_expense_photos_trip_expense_id_trip_expenses_id_fk" FOREIGN KEY ("trip_expense_id") REFERENCES "public"."trip_expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
DROP TYPE "public"."forwarder_expense_type";