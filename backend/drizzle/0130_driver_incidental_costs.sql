CREATE TYPE "public"."driver_incidental_cost_type" AS ENUM('PER_DIEM', 'LIFT_FEE', 'PARKING', 'TOLL', 'FUEL', 'OTHER');--> statement-breakpoint
CREATE TABLE "driver_incidental_costs" (
	"id" serial PRIMARY KEY NOT NULL,
	"trip_id" integer NOT NULL,
	"driver_id" integer NOT NULL,
	"cost_type" "driver_incidental_cost_type" NOT NULL,
	"amount" numeric(15, 0) NOT NULL,
	"occurred_at" date NOT NULL,
	"note" text,
	"recorded_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "driver_incidental_costs" ADD CONSTRAINT "driver_incidental_costs_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_incidental_costs" ADD CONSTRAINT "driver_incidental_costs_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_incidental_costs" ADD CONSTRAINT "driver_incidental_costs_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "driver_incidental_costs_trip_idx" ON "driver_incidental_costs" USING btree ("trip_id","occurred_at");--> statement-breakpoint
CREATE INDEX "driver_incidental_costs_driver_idx" ON "driver_incidental_costs" USING btree ("driver_id");