-- Reverts 0048_cute_wong.sql (N2 trip instructions).
-- Drops the trip_instructions table; the unique index and FK constraints
-- are dropped implicitly with the table.
DROP TABLE IF EXISTS "trip_instructions";
