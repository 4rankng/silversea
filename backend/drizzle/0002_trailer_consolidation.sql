-- Trailer consolidation: remove trailers table, add trailer fields to trucks,
-- replace trips.trailer_id with trips.trailer_type, drop expenses.trailer_id

-- 1. Add trailer columns to trucks
ALTER TABLE "trucks" ADD COLUMN "trailer_plate_number" varchar(20);
ALTER TABLE "trucks" ADD COLUMN "trailer_type" "trailer_type";

-- 2. Add trailer_type to trips (nullable for existing rows)
ALTER TABLE "trips" ADD COLUMN "trailer_type" "trailer_type";

-- 3. Drop trailer_id from expenses (was never used in production)
ALTER TABLE "expenses" DROP CONSTRAINT IF EXISTS "expenses_trailer_id_trailers_id_fk";
ALTER TABLE "expenses" DROP COLUMN IF EXISTS "trailer_id";

-- 4. Drop trailer_id FK from trips
ALTER TABLE "trips" DROP CONSTRAINT IF EXISTS "trips_trailer_id_trailers_id_fk";
ALTER TABLE "trips" DROP COLUMN IF EXISTS "trailer_id";

-- 5. Drop trailers table
DROP TABLE IF EXISTS "trailers";

-- 6. Drop unused trailer_status enum
DROP TYPE IF EXISTS "trailer_status";
