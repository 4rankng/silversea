CREATE TABLE "vehicle_last_positions" (
	"truck_id" integer PRIMARY KEY NOT NULL,
	"device_id" varchar(50),
	"lat" double precision,
	"lng" double precision,
	"speed" double precision,
	"angle" double precision,
	"address" text,
	"ignition_on" boolean DEFAULT false NOT NULL,
	"fuel" double precision,
	"gps_driver_name" varchar(255),
	"last_seen_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vehicle_last_positions" ADD CONSTRAINT "vehicle_last_positions_truck_id_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE no action ON UPDATE no action;