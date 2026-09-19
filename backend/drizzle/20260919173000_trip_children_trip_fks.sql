-- Trip children get their missing foreign keys to trips.
--
-- information_schema on 2026-09-19 showed 22 tables carrying trip_id with
-- NO live FK to trips (the 20260913_3 pass covered shipment children only).
-- Deleting trips then orphaned child rows silently — money rows nobody can
-- see (263 orphaned trip_expenses found on dev). Policies:
--   CASCADE (14) pure trip payload: dies with the trip.
--   RESTRICT (2) issued-money backstops: billing_document_trip_claims and
--     trip_financial_postings — a delete that would strand them must fail.
--   SET NULL (6) nullable detach-and-survive rows.
-- Orphan cleanup runs FIRST and is idempotent (fresh DB = no-op).
--
-- schema.ts intentionally does NOT declare these FKs — adding them there
-- would let a future drizzle-kit generate emit a migration dropping them.
-- This file is the single source of truth for the trip-child FK graph.

-- Phase 1: orphan cleanup (idempotent).
DELETE FROM trip_legs c WHERE c.trip_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM trips g WHERE g.id = c.trip_id);
--> statement-breakpoint
DELETE FROM trip_photos c WHERE c.trip_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM trips g WHERE g.id = c.trip_id);
--> statement-breakpoint
DELETE FROM trip_containers c WHERE c.trip_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM trips g WHERE g.id = c.trip_id);
--> statement-breakpoint
DELETE FROM trip_carrier_info c WHERE c.trip_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM trips g WHERE g.id = c.trip_id);
--> statement-breakpoint
DELETE FROM trip_financial_state c WHERE c.trip_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM trips g WHERE g.id = c.trip_id);
--> statement-breakpoint
DELETE FROM trip_expenses c WHERE c.trip_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM trips g WHERE g.id = c.trip_id);
--> statement-breakpoint
DELETE FROM trip_expense_completion_scopes c WHERE c.trip_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM trips g WHERE g.id = c.trip_id);
--> statement-breakpoint
DELETE FROM trip_pod_submissions c WHERE c.trip_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM trips g WHERE g.id = c.trip_id);
--> statement-breakpoint
DELETE FROM delivery_attempts c WHERE c.trip_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM trips g WHERE g.id = c.trip_id);
--> statement-breakpoint
DELETE FROM driver_incidental_costs c WHERE c.trip_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM trips g WHERE g.id = c.trip_id);
--> statement-breakpoint
DELETE FROM driver_progress_events c WHERE c.trip_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM trips g WHERE g.id = c.trip_id);
--> statement-breakpoint
DELETE FROM fuel_evidence_reviews c WHERE c.trip_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM trips g WHERE g.id = c.trip_id);
--> statement-breakpoint
DELETE FROM fuel_invoice_allocations c WHERE c.trip_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM trips g WHERE g.id = c.trip_id);
--> statement-breakpoint
DELETE FROM profitability_snapshots c WHERE c.trip_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM trips g WHERE g.id = c.trip_id);
--> statement-breakpoint
DELETE FROM billing_document_trip_claims c WHERE c.trip_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM trips g WHERE g.id = c.trip_id);
--> statement-breakpoint
DELETE FROM trip_financial_postings c WHERE c.trip_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM trips g WHERE g.id = c.trip_id);
--> statement-breakpoint
UPDATE freight_rate_snapshots SET trip_id = NULL WHERE trip_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM trips g WHERE g.id = freight_rate_snapshots.trip_id);
--> statement-breakpoint
UPDATE ancillary_revenue SET trip_id = NULL WHERE trip_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM trips g WHERE g.id = ancillary_revenue.trip_id);
--> statement-breakpoint
UPDATE penalties SET trip_id = NULL WHERE trip_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM trips g WHERE g.id = penalties.trip_id);
--> statement-breakpoint
UPDATE shipment_milestones SET trip_id = NULL WHERE trip_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM trips g WHERE g.id = shipment_milestones.trip_id);
--> statement-breakpoint
UPDATE expense_accounting_sources SET trip_id = NULL WHERE trip_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM trips g WHERE g.id = expense_accounting_sources.trip_id);
--> statement-breakpoint
UPDATE driver_work_days SET trip_id = NULL WHERE trip_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM trips g WHERE g.id = driver_work_days.trip_id);
--> statement-breakpoint

-- Phase 2: constraint adds, NOT VALID then VALIDATE (lock-friendly).
ALTER TABLE trip_legs ADD CONSTRAINT trip_legs_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE trip_legs VALIDATE CONSTRAINT trip_legs_trip_id_fkey;
--> statement-breakpoint
ALTER TABLE trip_photos ADD CONSTRAINT trip_photos_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE trip_photos VALIDATE CONSTRAINT trip_photos_trip_id_fkey;
--> statement-breakpoint
ALTER TABLE trip_containers ADD CONSTRAINT trip_containers_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE trip_containers VALIDATE CONSTRAINT trip_containers_trip_id_fkey;
--> statement-breakpoint
ALTER TABLE trip_carrier_info ADD CONSTRAINT trip_carrier_info_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE trip_carrier_info VALIDATE CONSTRAINT trip_carrier_info_trip_id_fkey;
--> statement-breakpoint
ALTER TABLE trip_financial_state ADD CONSTRAINT trip_financial_state_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE trip_financial_state VALIDATE CONSTRAINT trip_financial_state_trip_id_fkey;
--> statement-breakpoint
ALTER TABLE trip_expenses ADD CONSTRAINT trip_expenses_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE trip_expenses VALIDATE CONSTRAINT trip_expenses_trip_id_fkey;
--> statement-breakpoint
ALTER TABLE trip_expense_completion_scopes ADD CONSTRAINT trip_expense_completion_scopes_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE trip_expense_completion_scopes VALIDATE CONSTRAINT trip_expense_completion_scopes_trip_id_fkey;
--> statement-breakpoint
ALTER TABLE trip_pod_submissions ADD CONSTRAINT trip_pod_submissions_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE trip_pod_submissions VALIDATE CONSTRAINT trip_pod_submissions_trip_id_fkey;
--> statement-breakpoint
ALTER TABLE delivery_attempts ADD CONSTRAINT delivery_attempts_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE delivery_attempts VALIDATE CONSTRAINT delivery_attempts_trip_id_fkey;
--> statement-breakpoint
ALTER TABLE driver_incidental_costs ADD CONSTRAINT driver_incidental_costs_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE driver_incidental_costs VALIDATE CONSTRAINT driver_incidental_costs_trip_id_fkey;
--> statement-breakpoint
ALTER TABLE driver_progress_events ADD CONSTRAINT driver_progress_events_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE driver_progress_events VALIDATE CONSTRAINT driver_progress_events_trip_id_fkey;
--> statement-breakpoint
ALTER TABLE fuel_evidence_reviews ADD CONSTRAINT fuel_evidence_reviews_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE fuel_evidence_reviews VALIDATE CONSTRAINT fuel_evidence_reviews_trip_id_fkey;
--> statement-breakpoint
ALTER TABLE fuel_invoice_allocations ADD CONSTRAINT fuel_invoice_allocations_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE fuel_invoice_allocations VALIDATE CONSTRAINT fuel_invoice_allocations_trip_id_fkey;
--> statement-breakpoint
ALTER TABLE profitability_snapshots ADD CONSTRAINT profitability_snapshots_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE profitability_snapshots VALIDATE CONSTRAINT profitability_snapshots_trip_id_fkey;
--> statement-breakpoint
ALTER TABLE billing_document_trip_claims ADD CONSTRAINT billing_document_trip_claims_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE billing_document_trip_claims VALIDATE CONSTRAINT billing_document_trip_claims_trip_id_fkey;
--> statement-breakpoint
ALTER TABLE trip_financial_postings ADD CONSTRAINT trip_financial_postings_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE trip_financial_postings VALIDATE CONSTRAINT trip_financial_postings_trip_id_fkey;
--> statement-breakpoint
ALTER TABLE freight_rate_snapshots ADD CONSTRAINT freight_rate_snapshots_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
ALTER TABLE freight_rate_snapshots VALIDATE CONSTRAINT freight_rate_snapshots_trip_id_fkey;
--> statement-breakpoint
ALTER TABLE ancillary_revenue ADD CONSTRAINT ancillary_revenue_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
ALTER TABLE ancillary_revenue VALIDATE CONSTRAINT ancillary_revenue_trip_id_fkey;
--> statement-breakpoint
ALTER TABLE penalties ADD CONSTRAINT penalties_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
ALTER TABLE penalties VALIDATE CONSTRAINT penalties_trip_id_fkey;
--> statement-breakpoint
ALTER TABLE shipment_milestones ADD CONSTRAINT shipment_milestones_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
ALTER TABLE shipment_milestones VALIDATE CONSTRAINT shipment_milestones_trip_id_fkey;
--> statement-breakpoint
ALTER TABLE expense_accounting_sources ADD CONSTRAINT expense_accounting_sources_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
ALTER TABLE expense_accounting_sources VALIDATE CONSTRAINT expense_accounting_sources_trip_id_fkey;
--> statement-breakpoint
ALTER TABLE driver_work_days ADD CONSTRAINT driver_work_days_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
ALTER TABLE driver_work_days VALIDATE CONSTRAINT driver_work_days_trip_id_fkey;
--> statement-breakpoint
