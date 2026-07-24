CREATE TYPE "public"."salary_confirmation_status" AS ENUM('DRAFT', 'CONFIRMED');--> statement-breakpoint
CREATE TABLE "salary_confirmations" (
	"id" serial PRIMARY KEY NOT NULL,
	"driver_id" integer NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"status" "salary_confirmation_status" DEFAULT 'DRAFT' NOT NULL,
	"confirmed_by" integer,
	"confirmed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "salary_confirmations" ADD CONSTRAINT "salary_confirmations_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_confirmations" ADD CONSTRAINT "salary_confirmations_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "salary_confirmations_driver_period_idx" ON "salary_confirmations" USING btree ("driver_id","year","month");