CREATE TYPE "public"."work_day_status" AS ENUM('TRIP_DAY', 'STANDBY', 'PERSONAL_LEAVE', 'WEEKLY_OFF');--> statement-breakpoint
CREATE TABLE "driver_work_days" (
	"id" serial PRIMARY KEY NOT NULL,
	"driver_id" integer NOT NULL,
	"date" date NOT NULL,
	"status" "work_day_status" NOT NULL,
	"trip_id" integer,
	"note" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "trip_wage_days" integer;--> statement-breakpoint
ALTER TABLE "driver_work_days" ADD CONSTRAINT "driver_work_days_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_work_days" ADD CONSTRAINT "driver_work_days_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_work_days" ADD CONSTRAINT "driver_work_days_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "driver_work_days_driver_date_idx" ON "driver_work_days" USING btree ("driver_id","date");--> statement-breakpoint
CREATE INDEX "driver_work_days_driver_idx" ON "driver_work_days" USING btree ("driver_id");