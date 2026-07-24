-- Drop the FK constraint on expenses.truck_id.
-- Reason: expenses.truck_id is polymorphic — it holds either trucks.id (when
-- vehicle_component='TRUCK') or trailers.id (when vehicle_component='TRAILER').
-- A standard FK can only point at one table, so trailer-tagged expenses fail
-- to insert (Pete reported this as "trailer expenses save successfully but
-- show no plate on the list"). Integrity of the polymorphic reference is
-- maintained at the service layer (expense.service.ts).

ALTER TABLE "expenses" DROP CONSTRAINT IF EXISTS "expenses_truck_id_trucks_id_fk";
