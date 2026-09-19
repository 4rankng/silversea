-- Shipment-side children get their missing foreign keys (the _23
-- treatment extended: shipments, routes, and billing documents as
-- parents). Policies adjudicated 2026-09-19: CASCADE = payload that dies
-- with the parent; RESTRICT = money/issuance backstops and pricing
-- config (a delete that would strand them must fail); SET NULL =
-- nullable detach-and-survive rows. Orphan cleanup runs first, idempotent.
-- trips_composite is a VIEW and is excluded (views carry no FKs).
--
-- schema.ts intentionally does NOT declare these FKs so a future
-- drizzle-kit generate cannot drop them; this file is the source of truth.

-- Phase 1: orphan cleanup (idempotent).
DELETE FROM customer_visible_events c WHERE c.shipment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shipments g WHERE g.id = c.shipment_id);
--> statement-breakpoint
DELETE FROM delivery_attempts c WHERE c.shipment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shipments g WHERE g.id = c.shipment_id);
--> statement-breakpoint
DELETE FROM dispatch_handoffs c WHERE c.shipment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shipments g WHERE g.id = c.shipment_id);
--> statement-breakpoint
DELETE FROM shipment_change_requests c WHERE c.shipment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shipments g WHERE g.id = c.shipment_id);
--> statement-breakpoint
DELETE FROM shipment_cost_adjustments c WHERE c.shipment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shipments g WHERE g.id = c.shipment_id);
--> statement-breakpoint
DELETE FROM shipment_declarations c WHERE c.shipment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shipments g WHERE g.id = c.shipment_id);
--> statement-breakpoint
DELETE FROM shipment_document_custody_facts c WHERE c.shipment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shipments g WHERE g.id = c.shipment_id);
--> statement-breakpoint
DELETE FROM shipment_documents c WHERE c.shipment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shipments g WHERE g.id = c.shipment_id);
--> statement-breakpoint
DELETE FROM shipment_finance_actions c WHERE c.shipment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shipments g WHERE g.id = c.shipment_id);
--> statement-breakpoint
DELETE FROM shipment_milestones c WHERE c.shipment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shipments g WHERE g.id = c.shipment_id);
--> statement-breakpoint
DELETE FROM shipment_recovery_facts c WHERE c.shipment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shipments g WHERE g.id = c.shipment_id);
--> statement-breakpoint
DELETE FROM shipment_status_history c WHERE c.shipment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shipments g WHERE g.id = c.shipment_id);
--> statement-breakpoint
DELETE FROM user_shipment_links c WHERE c.shipment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shipments g WHERE g.id = c.shipment_id);
--> statement-breakpoint
DELETE FROM user_shipment_pins c WHERE c.shipment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shipments g WHERE g.id = c.shipment_id);
--> statement-breakpoint
DELETE FROM debit_note_lots c WHERE c.shipment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shipments g WHERE g.id = c.shipment_id);
--> statement-breakpoint
DELETE FROM shipment_accounting_locks c WHERE c.shipment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shipments g WHERE g.id = c.shipment_id);
--> statement-breakpoint
DELETE FROM shipment_cost_locks c WHERE c.shipment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shipments g WHERE g.id = c.shipment_id);
--> statement-breakpoint
DELETE FROM ops_expense_entries c WHERE c.shipment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shipments g WHERE g.id = c.shipment_id);
--> statement-breakpoint
DELETE FROM container_deposit_records c WHERE c.shipment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shipments g WHERE g.id = c.shipment_id);
--> statement-breakpoint
DELETE FROM shipment_invoice_records c WHERE c.shipment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shipments g WHERE g.id = c.shipment_id);
--> statement-breakpoint
DELETE FROM expense_accounting_sources c WHERE c.shipment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shipments g WHERE g.id = c.shipment_id);
--> statement-breakpoint
UPDATE ancillary_revenue SET shipment_id = NULL WHERE shipment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shipments g WHERE g.id = ancillary_revenue.shipment_id);
--> statement-breakpoint
UPDATE credit_override_requests SET shipment_id = NULL WHERE shipment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shipments g WHERE g.id = credit_override_requests.shipment_id);
--> statement-breakpoint
UPDATE customer_email_logs SET shipment_id = NULL WHERE shipment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shipments g WHERE g.id = customer_email_logs.shipment_id);
--> statement-breakpoint
UPDATE freight_rate_snapshots SET shipment_id = NULL WHERE shipment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shipments g WHERE g.id = freight_rate_snapshots.shipment_id);
--> statement-breakpoint
UPDATE profitability_snapshots SET shipment_id = NULL WHERE shipment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shipments g WHERE g.id = profitability_snapshots.shipment_id);
--> statement-breakpoint
UPDATE salesperson_assignments SET shipment_id = NULL WHERE shipment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shipments g WHERE g.id = salesperson_assignments.shipment_id);
--> statement-breakpoint
UPDATE trips SET shipment_id = NULL WHERE shipment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shipments g WHERE g.id = trips.shipment_id);
--> statement-breakpoint
DELETE FROM freight_rate_terms c WHERE c.route_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM routes g WHERE g.id = c.route_id);
--> statement-breakpoint
DELETE FROM fuel_norms c WHERE c.route_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM routes g WHERE g.id = c.route_id);
--> statement-breakpoint
DELETE FROM pricing_tables c WHERE c.route_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM routes g WHERE g.id = c.route_id);
--> statement-breakpoint
DELETE FROM road_allowances c WHERE c.route_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM routes g WHERE g.id = c.route_id);
--> statement-breakpoint
DELETE FROM weight_pricing_tiers c WHERE c.route_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM routes g WHERE g.id = c.route_id);
--> statement-breakpoint
DELETE FROM trips c WHERE c.route_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM routes g WHERE g.id = c.route_id);
--> statement-breakpoint
UPDATE operational_sites SET route_id = NULL WHERE route_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM routes g WHERE g.id = operational_sites.route_id);
--> statement-breakpoint
UPDATE shipment_containers SET route_id = NULL WHERE route_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM routes g WHERE g.id = shipment_containers.route_id);
--> statement-breakpoint
UPDATE shipments SET route_id = NULL WHERE route_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM routes g WHERE g.id = shipments.route_id);
--> statement-breakpoint
DELETE FROM payment_allocations c WHERE c.billing_document_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM billing_documents g WHERE g.id = c.billing_document_id);
--> statement-breakpoint
DELETE FROM shipment_accounting_locks c WHERE c.billing_document_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM billing_documents g WHERE g.id = c.billing_document_id);
--> statement-breakpoint
UPDATE customer_email_logs SET billing_document_id = NULL WHERE billing_document_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM billing_documents g WHERE g.id = customer_email_logs.billing_document_id);
--> statement-breakpoint

-- Phase 2: constraint adds, NOT VALID then VALIDATE (lock-friendly).
ALTER TABLE customer_visible_events ADD CONSTRAINT customer_visible_events_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE customer_visible_events VALIDATE CONSTRAINT customer_visible_events_shipment_id_fkey;
--> statement-breakpoint
ALTER TABLE delivery_attempts ADD CONSTRAINT delivery_attempts_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE delivery_attempts VALIDATE CONSTRAINT delivery_attempts_shipment_id_fkey;
--> statement-breakpoint
ALTER TABLE dispatch_handoffs ADD CONSTRAINT dispatch_handoffs_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE dispatch_handoffs VALIDATE CONSTRAINT dispatch_handoffs_shipment_id_fkey;
--> statement-breakpoint
ALTER TABLE shipment_change_requests ADD CONSTRAINT shipment_change_requests_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE shipment_change_requests VALIDATE CONSTRAINT shipment_change_requests_shipment_id_fkey;
--> statement-breakpoint
ALTER TABLE shipment_cost_adjustments ADD CONSTRAINT shipment_cost_adjustments_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE shipment_cost_adjustments VALIDATE CONSTRAINT shipment_cost_adjustments_shipment_id_fkey;
--> statement-breakpoint
ALTER TABLE shipment_declarations ADD CONSTRAINT shipment_declarations_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE shipment_declarations VALIDATE CONSTRAINT shipment_declarations_shipment_id_fkey;
--> statement-breakpoint
ALTER TABLE shipment_document_custody_facts ADD CONSTRAINT shipment_document_custody_facts_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE shipment_document_custody_facts VALIDATE CONSTRAINT shipment_document_custody_facts_shipment_id_fkey;
--> statement-breakpoint
ALTER TABLE shipment_documents ADD CONSTRAINT shipment_documents_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE shipment_documents VALIDATE CONSTRAINT shipment_documents_shipment_id_fkey;
--> statement-breakpoint
ALTER TABLE shipment_finance_actions ADD CONSTRAINT shipment_finance_actions_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE shipment_finance_actions VALIDATE CONSTRAINT shipment_finance_actions_shipment_id_fkey;
--> statement-breakpoint
ALTER TABLE shipment_milestones ADD CONSTRAINT shipment_milestones_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE shipment_milestones VALIDATE CONSTRAINT shipment_milestones_shipment_id_fkey;
--> statement-breakpoint
ALTER TABLE shipment_recovery_facts ADD CONSTRAINT shipment_recovery_facts_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE shipment_recovery_facts VALIDATE CONSTRAINT shipment_recovery_facts_shipment_id_fkey;
--> statement-breakpoint
ALTER TABLE shipment_status_history ADD CONSTRAINT shipment_status_history_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE shipment_status_history VALIDATE CONSTRAINT shipment_status_history_shipment_id_fkey;
--> statement-breakpoint
ALTER TABLE user_shipment_links ADD CONSTRAINT user_shipment_links_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE user_shipment_links VALIDATE CONSTRAINT user_shipment_links_shipment_id_fkey;
--> statement-breakpoint
ALTER TABLE user_shipment_pins ADD CONSTRAINT user_shipment_pins_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE user_shipment_pins VALIDATE CONSTRAINT user_shipment_pins_shipment_id_fkey;
--> statement-breakpoint
ALTER TABLE debit_note_lots ADD CONSTRAINT debit_note_lots_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE debit_note_lots VALIDATE CONSTRAINT debit_note_lots_shipment_id_fkey;
--> statement-breakpoint
ALTER TABLE shipment_accounting_locks ADD CONSTRAINT shipment_accounting_locks_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE shipment_accounting_locks VALIDATE CONSTRAINT shipment_accounting_locks_shipment_id_fkey;
--> statement-breakpoint
ALTER TABLE shipment_cost_locks ADD CONSTRAINT shipment_cost_locks_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE shipment_cost_locks VALIDATE CONSTRAINT shipment_cost_locks_shipment_id_fkey;
--> statement-breakpoint
ALTER TABLE ops_expense_entries ADD CONSTRAINT ops_expense_entries_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE ops_expense_entries VALIDATE CONSTRAINT ops_expense_entries_shipment_id_fkey;
--> statement-breakpoint
ALTER TABLE container_deposit_records ADD CONSTRAINT container_deposit_records_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE container_deposit_records VALIDATE CONSTRAINT container_deposit_records_shipment_id_fkey;
--> statement-breakpoint
ALTER TABLE shipment_invoice_records ADD CONSTRAINT shipment_invoice_records_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE shipment_invoice_records VALIDATE CONSTRAINT shipment_invoice_records_shipment_id_fkey;
--> statement-breakpoint
ALTER TABLE expense_accounting_sources ADD CONSTRAINT expense_accounting_sources_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE expense_accounting_sources VALIDATE CONSTRAINT expense_accounting_sources_shipment_id_fkey;
--> statement-breakpoint
ALTER TABLE ancillary_revenue ADD CONSTRAINT ancillary_revenue_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
ALTER TABLE ancillary_revenue VALIDATE CONSTRAINT ancillary_revenue_shipment_id_fkey;
--> statement-breakpoint
ALTER TABLE credit_override_requests ADD CONSTRAINT credit_override_requests_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
ALTER TABLE credit_override_requests VALIDATE CONSTRAINT credit_override_requests_shipment_id_fkey;
--> statement-breakpoint
ALTER TABLE customer_email_logs ADD CONSTRAINT customer_email_logs_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
ALTER TABLE customer_email_logs VALIDATE CONSTRAINT customer_email_logs_shipment_id_fkey;
--> statement-breakpoint
ALTER TABLE freight_rate_snapshots ADD CONSTRAINT freight_rate_snapshots_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
ALTER TABLE freight_rate_snapshots VALIDATE CONSTRAINT freight_rate_snapshots_shipment_id_fkey;
--> statement-breakpoint
ALTER TABLE profitability_snapshots ADD CONSTRAINT profitability_snapshots_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
ALTER TABLE profitability_snapshots VALIDATE CONSTRAINT profitability_snapshots_shipment_id_fkey;
--> statement-breakpoint
ALTER TABLE salesperson_assignments ADD CONSTRAINT salesperson_assignments_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
ALTER TABLE salesperson_assignments VALIDATE CONSTRAINT salesperson_assignments_shipment_id_fkey;
--> statement-breakpoint
ALTER TABLE trips ADD CONSTRAINT trips_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
ALTER TABLE trips VALIDATE CONSTRAINT trips_shipment_id_fkey;
--> statement-breakpoint
ALTER TABLE freight_rate_terms ADD CONSTRAINT freight_rate_terms_route_id_fkey FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE freight_rate_terms VALIDATE CONSTRAINT freight_rate_terms_route_id_fkey;
--> statement-breakpoint
ALTER TABLE fuel_norms ADD CONSTRAINT fuel_norms_route_id_fkey FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE fuel_norms VALIDATE CONSTRAINT fuel_norms_route_id_fkey;
--> statement-breakpoint
ALTER TABLE pricing_tables ADD CONSTRAINT pricing_tables_route_id_fkey FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE pricing_tables VALIDATE CONSTRAINT pricing_tables_route_id_fkey;
--> statement-breakpoint
ALTER TABLE road_allowances ADD CONSTRAINT road_allowances_route_id_fkey FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE road_allowances VALIDATE CONSTRAINT road_allowances_route_id_fkey;
--> statement-breakpoint
ALTER TABLE weight_pricing_tiers ADD CONSTRAINT weight_pricing_tiers_route_id_fkey FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE weight_pricing_tiers VALIDATE CONSTRAINT weight_pricing_tiers_route_id_fkey;
--> statement-breakpoint
ALTER TABLE trips ADD CONSTRAINT trips_route_id_fkey FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE trips VALIDATE CONSTRAINT trips_route_id_fkey;
--> statement-breakpoint
ALTER TABLE operational_sites ADD CONSTRAINT operational_sites_route_id_fkey FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
ALTER TABLE operational_sites VALIDATE CONSTRAINT operational_sites_route_id_fkey;
--> statement-breakpoint
ALTER TABLE shipment_containers ADD CONSTRAINT shipment_containers_route_id_fkey FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
ALTER TABLE shipment_containers VALIDATE CONSTRAINT shipment_containers_route_id_fkey;
--> statement-breakpoint
ALTER TABLE shipments ADD CONSTRAINT shipments_route_id_fkey FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
ALTER TABLE shipments VALIDATE CONSTRAINT shipments_route_id_fkey;
--> statement-breakpoint
ALTER TABLE payment_allocations ADD CONSTRAINT payment_allocations_billing_document_id_fkey FOREIGN KEY (billing_document_id) REFERENCES billing_documents(id) ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE payment_allocations VALIDATE CONSTRAINT payment_allocations_billing_document_id_fkey;
--> statement-breakpoint
ALTER TABLE shipment_accounting_locks ADD CONSTRAINT shipment_accounting_locks_billing_document_id_fkey FOREIGN KEY (billing_document_id) REFERENCES billing_documents(id) ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE shipment_accounting_locks VALIDATE CONSTRAINT shipment_accounting_locks_billing_document_id_fkey;
--> statement-breakpoint
ALTER TABLE customer_email_logs ADD CONSTRAINT customer_email_logs_billing_document_id_fkey FOREIGN KEY (billing_document_id) REFERENCES billing_documents(id) ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
ALTER TABLE customer_email_logs VALIDATE CONSTRAINT customer_email_logs_billing_document_id_fkey;
--> statement-breakpoint
