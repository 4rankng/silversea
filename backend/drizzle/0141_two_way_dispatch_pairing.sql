CREATE TABLE "trip_pairs" (
	"id" serial PRIMARY KEY NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"first_trip_id" integer NOT NULL,
	"second_trip_id" integer NOT NULL,
	"empty_distance_km" numeric(10, 2),
	"combined_efficiency_percent" numeric(6, 2),
	"required_gap_minutes" integer,
	"actual_gap_minutes" integer,
	"break_reason" varchar(40),
	"surviving_trip_id" integer,
	"late_by_minutes" integer,
	"created_by" integer,
	"broken_by" integer,
	"broken_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "trip_pairs_status_check" CHECK ("trip_pairs"."status" in ('ACTIVE', 'BROKEN')),
	CONSTRAINT "trip_pairs_distinct_trip_check" CHECK ("trip_pairs"."first_trip_id" <> "trip_pairs"."second_trip_id"),
	CONSTRAINT "trip_pairs_break_reason_check" CHECK ("trip_pairs"."break_reason" is null or "trip_pairs"."break_reason" in ('FIRST_TRIP_CANCELED', 'SECOND_TRIP_CANCELED', 'LATE_COMPLETION'))
);
--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "planned_start_at" timestamp;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "planned_end_at" timestamp;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "canonical_origin" varchar(160);--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "canonical_destination" varchar(160);--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "cargo_weight_kg" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "vehicle_capacity_kg" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "active_trip_pair_id" integer;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "active_trip_pair_order" integer;--> statement-breakpoint
ALTER TABLE "trip_pairs" ADD CONSTRAINT "trip_pairs_first_trip_id_trips_id_fk" FOREIGN KEY ("first_trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_pairs" ADD CONSTRAINT "trip_pairs_second_trip_id_trips_id_fk" FOREIGN KEY ("second_trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_pairs" ADD CONSTRAINT "trip_pairs_surviving_trip_id_trips_id_fk" FOREIGN KEY ("surviving_trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_pairs" ADD CONSTRAINT "trip_pairs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_pairs" ADD CONSTRAINT "trip_pairs_broken_by_users_id_fk" FOREIGN KEY ("broken_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_active_trip_pair_id_trip_pairs_id_fk" FOREIGN KEY ("active_trip_pair_id") REFERENCES "public"."trip_pairs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trip_pairs_trip_order_uniq_idx" ON "trip_pairs" USING btree ("first_trip_id","second_trip_id");--> statement-breakpoint
CREATE INDEX "trip_pairs_status_idx" ON "trip_pairs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "trips_active_trip_pair_idx" ON "trips" USING btree ("active_trip_pair_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trips_active_trip_pair_order_uniq" ON "trips" USING btree ("active_trip_pair_id","active_trip_pair_order") WHERE "trips"."active_trip_pair_id" is not null;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_active_trip_pair_order_check" CHECK ("trips"."active_trip_pair_order" is null or "trips"."active_trip_pair_order" in (1, 2));--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_active_trip_pair_presence_check" CHECK (("trips"."active_trip_pair_id" is null and "trips"."active_trip_pair_order" is null)
      or ("trips"."active_trip_pair_id" is not null and "trips"."active_trip_pair_order" is not null));
