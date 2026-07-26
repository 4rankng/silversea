CREATE TYPE "public"."driver_progress_event_type" AS ENUM('DEPARTED', 'ARRIVED', 'FUELED', 'INCIDENT', 'NOTE');--> statement-breakpoint
CREATE TABLE "driver_progress_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"trip_id" integer NOT NULL,
	"driver_id" integer NOT NULL,
	"event_type" "driver_progress_event_type" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"note" text,
	"recorded_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "driver_progress_events" ADD CONSTRAINT "driver_progress_events_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_progress_events" ADD CONSTRAINT "driver_progress_events_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_progress_events" ADD CONSTRAINT "driver_progress_events_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "driver_progress_events_trip_idx" ON "driver_progress_events" USING btree ("trip_id","occurred_at");--> statement-breakpoint
CREATE INDEX "driver_progress_events_driver_idx" ON "driver_progress_events" USING btree ("driver_id");