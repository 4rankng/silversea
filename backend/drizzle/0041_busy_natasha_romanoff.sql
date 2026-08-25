CREATE TABLE "truck_driver_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"truck_id" integer NOT NULL,
	"driver_id" integer NOT NULL,
	"role" varchar(20) DEFAULT 'PRIMARY' NOT NULL,
	"starts_at" timestamp DEFAULT now() NOT NULL,
	"ends_at" timestamp,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "truck_driver_assignments_active_primary_per_truck" ON "truck_driver_assignments" USING btree ("truck_id") WHERE "truck_driver_assignments"."ends_at" is null and "truck_driver_assignments"."role" = 'PRIMARY';--> statement-breakpoint
CREATE UNIQUE INDEX "truck_driver_assignments_active_primary_per_driver" ON "truck_driver_assignments" USING btree ("driver_id") WHERE "truck_driver_assignments"."ends_at" is null and "truck_driver_assignments"."role" = 'PRIMARY';
--> statement-breakpoint
-- Backfill: one active PRIMARY assignment per driver's current legacy
-- assignedTruckId (the pre-migration detection pass found zero trucks with
-- multiple active drivers, so this insert cannot violate either partial
-- unique index). The legacy drivers.assigned_truck_id column stays in place,
-- read-only, until the Phase 5 cleanup gate.
INSERT INTO "truck_driver_assignments" ("truck_id", "driver_id")
SELECT d."assigned_truck_id", d."id"
FROM "drivers" d
WHERE d."assigned_truck_id" IS NOT NULL
  AND d."status" = 'ACTIVE'
  AND d."deleted_at" IS NULL;
