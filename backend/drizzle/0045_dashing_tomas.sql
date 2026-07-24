CREATE TABLE "trip_container_seals" (
	"id" serial PRIMARY KEY NOT NULL,
	"trip_container_id" integer NOT NULL,
	"seal_number" varchar(50) NOT NULL,
	"seal_type" varchar(30),
	"notes" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trip_photos" ADD COLUMN "trip_container_id" integer;--> statement-breakpoint
ALTER TABLE "trip_container_seals" ADD CONSTRAINT "trip_container_seals_trip_container_id_trip_containers_id_fk" FOREIGN KEY ("trip_container_id") REFERENCES "public"."trip_containers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_container_seals" ADD CONSTRAINT "trip_container_seals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trip_container_seals_container_idx" ON "trip_container_seals" USING btree ("trip_container_id");--> statement-breakpoint
CREATE INDEX "trip_photos_trip_container_id_idx" ON "trip_photos" USING btree ("trip_container_id");--> statement-breakpoint
ALTER TABLE "trip_photos" ADD CONSTRAINT "trip_photos_trip_container_id_trip_containers_id_fk" FOREIGN KEY ("trip_container_id") REFERENCES "public"."trip_containers"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- Backfill: promote each container's legacy seal_number into the new child
-- table as its first seal row. Idempotent — safe to re-run. Verified count
-- against live dev DB: 44 of 45 rows have a non-empty seal_number.
INSERT INTO "trip_container_seals" ("trip_container_id", "seal_number", "created_at", "updated_at")
SELECT tc.id, tc.seal_number, NOW(), NOW()
FROM "trip_containers" tc
WHERE tc.seal_number IS NOT NULL
  AND tc.seal_number <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "trip_container_seals" tcs
    WHERE tcs.trip_container_id = tc.id
  );
