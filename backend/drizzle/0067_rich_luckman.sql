CREATE TABLE "trip_gps_tracks" (
	"id" serial PRIMARY KEY NOT NULL,
	"trip_id" integer NOT NULL,
	"route_id" integer,
	"truck_id" integer,
	"car_id" integer,
	"license_plate" varchar(20),
	"encoded_polyline" text NOT NULL,
	"point_count" integer DEFAULT 0 NOT NULL,
	"distance_km" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"status" varchar(16) DEFAULT 'ok' NOT NULL,
	"segment_matched" boolean DEFAULT false NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error_kind" varchar(32)
);
--> statement-breakpoint
ALTER TABLE "trip_gps_tracks" ADD CONSTRAINT "trip_gps_tracks_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_gps_tracks" ADD CONSTRAINT "trip_gps_tracks_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_gps_tracks" ADD CONSTRAINT "trip_gps_tracks_truck_id_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trip_gps_tracks_trip_uniq_idx" ON "trip_gps_tracks" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "trip_gps_tracks_route_idx" ON "trip_gps_tracks" USING btree ("route_id");--> statement-breakpoint
CREATE INDEX "trip_gps_tracks_truck_ended_idx" ON "trip_gps_tracks" USING btree ("truck_id","ended_at");