/**
 * Wipe all business data in FK-safe order while PRESERVING user accounts and
 * auth/account tables.
 *
 * Hard contract (enforced by tests):
 *   - `users` is NEVER touched.
 *   - `push_subscriptions`,
 *     `agent_*`, `faq_entries`, `knowledge_chunks`, `idempotency_keys` are
 *     NEVER touched.
 *
 * Strategy: `TRUNCATE ... CASCADE` the business tables in one statement.
 * Postgres resolves FK dependencies when CASCADE is present, so the grouping
 * below is organizational (for readability of the dry-run output) rather than
 * a strict ordering requirement. The explicit table list is the source of
 * truth and must stay in sync with `backend/src/db/schema.ts`.
 *
 * Part of plans/260731-customer-audit-reseed. See
 * docs/customer-workflow-gap-analysis.md for context.
 */
import { sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';

/**
 * Tables that hold user/auth/account state. NEVER wiped.
 * Listed here so the wipe-list maintainer can diff against schema.ts exports.
 */
export const PRESERVED_TABLES = [
  'users',
  'push_subscriptions',
  'agent_conversations',
  'agent_messages',
  'faq_entries',
  'knowledge_chunks',
  'idempotency_keys',
] as const;

/**
 * Business tables to wipe, grouped by domain for readability. TRUNCATE
 * CASCADE resolves the actual FK ordering, so the group order is only for
 * dry-run legibility.
 *
 * Sync checklist when adding a table to schema.ts:
 *   1. Add it to the right group below.
 *   2. Confirm it is NOT a user/auth table (see PRESERVED_TABLES).
 *   3. Re-run the wipe dry-run + the wipe-contract test.
 */
export const WIPE_TABLES = {
  // 1. Trip children → trips
  tripsChildren: [
    'trip_expense_completion_scopes', 'trip_expense_photos', 'trip_expenses',
    'trip_container_seals', 'trip_containers', 'trip_instructions',
    'trip_photos', 'trip_gps_tracks', 'trip_gps_capture_jobs',
    'vehicle_last_positions', 'trip_legs', 'trip_pairs', 'trips',
    'trip_code_counters', 'driver_progress_events', 'driver_incidental_costs',
    'driver_work_days',
  ],
  // 2. Shipment children → shipments
  shipmentsChildren: [
    'shipment_milestones', 'shipment_change_requests', 'shipment_containers',
    'shipment_documents', 'shipment_declarations', 'shipment_status_history',
    'user_shipment_links', 'shipments',
  ],
  // 3. Financial / billing / ledger
  financial: [
    'billing_document_lines', 'billing_document_source_period_locks',
    'billing_documents', 'period_locks', 'governance_actions',
    'debit_note_templates', 'payment_allocations', 'payment_refunds',
    'payment_receipts', 'credit_override_requests',
    'ledger', 'distributions', 'debt_offsets',
    'salary_period_adjustments', 'salary_period_closes', 'salary_confirmations',
    'settlement_expense_adjustments', 'settlement_expenses',
    'advance_settlement_requests', 'advance_settlements', 'advance_requests',
    'management_fees', 'salary_periods',
    'truck_cap_table', 'cap_table_history',
    'dispatch_handoffs',
  ],
  // 4. Expenses
  expenses: ['expense_photos', 'expenses', 'penalties'],
  // 5. Fleet + fuel
  fleet: [
    'fuel_invoice_allocations', 'fuel_invoices', 'fuel_recon_explanations',
    'fuel_period_adjustments', 'tires', 'fuel_norms', 'fuel_price_history',
    'fuel_config', 'trailers', 'trucks', 'drivers',
  ],
  // 6. Customers / partners / link tables (re-created by seed)
  customersPartners: [
    'customer_email_logs', 'user_customer_links', 'user_business_unit_links',
    'business_calendar_days', 'business_units', 'customers', 'partners',
  ],
  // 7. Routes / pricing
  routesPricing: [
    'route_polylines', 'ancillary_revenue', 'lift_pricing',
    'weight_pricing_tiers', 'road_allowances', 'pricing_tables',
    'cargo_types', 'routes',
  ],
  // 8. Suppliers / categories / penalties reasons
  suppliersCategories: ['suppliers', 'expense_categories', 'penalty_reasons'],
  // 9. Reference data (re-seeded)
  reference: [
    'forwarder_expense_types', 'container_types', 'seal_types', 'ports',
    'road_config', 'app_settings',
  ],
  // 10. Operational logs/jobs (wiped so the demo starts clean)
  logs: ['notifications', 'audit_logs', 'photo_geotags', 'scheduler_run_logs', 'durable_effect_jobs'],
} as const;

/** Flatten the grouped wipe list into a single ordered table-name array. */
export function wipeTableList(): string[] {
  return Object.values(WIPE_TABLES).flat();
}

/**
 * Dry-run: return the list of tables that would be truncated, grouped, plus
 * the preserved list for contrast. Does NOT touch the DB.
 */
export function planWipe(): { wipe: Record<string, readonly string[]>; preserved: readonly string[] } {
  return { wipe: { ...WIPE_TABLES }, preserved: PRESERVED_TABLES };
}

/**
 * Execute the wipe. Uses TRUNCATE ... CASCADE so FK ordering is handled by
 * Postgres. `users` and other preserved tables are explicitly NOT in the list.
 *
 * Returns the count of tables truncated.
 */
export async function executeWipe(db: Database): Promise<number> {
  const tables = wipeTableList();
  // Quote each identifier to be safe against reserved words.
  const list = tables.map((t) => `"${t}"`).join(', ');
  await db.execute(sql.raw(`TRUNCATE ${list} RESTART IDENTITY CASCADE`));
  return tables.length;
}
