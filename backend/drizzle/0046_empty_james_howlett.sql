ALTER TABLE "trip_expenses" ADD COLUMN "trip_container_id" integer;--> statement-breakpoint
ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_trip_container_id_trip_containers_id_fk" FOREIGN KEY ("trip_container_id") REFERENCES "public"."trip_containers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trip_expenses_trip_container_id_idx" ON "trip_expenses" USING btree ("trip_container_id");

-- B5 rollback (manual — drizzle-kit is forward-only). Safe to leave the column
-- in place; run this only if the change must be reverted:
-- DROP INDEX IF EXISTS "trip_expenses_trip_container_id_idx";
-- ALTER TABLE "trip_expenses" DROP CONSTRAINT IF EXISTS "trip_expenses_trip_container_id_trip_containers_id_fk";
-- ALTER TABLE "trip_expenses" DROP COLUMN IF EXISTS "trip_container_id";