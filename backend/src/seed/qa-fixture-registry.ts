/**
 * Canonical registry of the QA-fixture data class (cards 20260925_41-45).
 *
 * QA runs create fixture rows directly on staging and nothing purged them, so
 * QA-pattern strings surfaced on business pages. This registry is the single
 * source of truth for what counts as a QA fixture: the purge script executes
 * it, the census/dry-run reports it, and future QA recipes EXTEND it instead
 * of inventing new fixture patterns.
 *
 * Ordering is children -> parents so lineage rows (expenses on QA shipments)
 * go before the parents they hang off. Every predicate is identifier-gated:
 * the QA-prefix class verified by enumeration (no real rows match; prod is
 * clean and refused outright by the executor).
 */

export interface QaFixtureSurface {
  table: string;
  label: string;
  predicate: string;
  action: 'soft-delete' | 'hard-delete' | 'hard-delete-guarded' | 'deactivate' | 'deactivate-plus-soft-delete' | 'scrub';
  guards: Array<{ table: string; column: string }>;
  /** Optional predicate on the row itself; true rows are skipped as guarded. */
  selfGuard?: string;
  /** For 'scrub': columns NULLed on matching rows (QA-authored text fields). */
  scrubColumns?: string[];
}

export const QA_SHIPMENT_FIELDS_SQL = `bl_number ILIKE 'QA%' OR booking_ref ILIKE 'QA%' OR shipment_code ILIKE 'QA%' OR bl_number ILIKE 'CARD226-QA-%' OR bl_number ILIKE 'BILL-QAC1%' OR operational_notes ILIKE 'QA-BUG3%'`;
export const QA_SHIPMENTS_SQL = `shipment_id IN (SELECT id FROM shipments WHERE ${QA_SHIPMENT_FIELDS_SQL})`;
const QA_TRIPS_SQL = `trip_id IN (SELECT t.id FROM trips t JOIN shipments s ON s.id = t.shipment_id WHERE s.bl_number ILIKE 'QA%' OR s.booking_ref ILIKE 'QA%' OR s.shipment_code ILIKE 'QA%' OR s.bl_number ILIKE 'CARD226-QA-%' OR s.bl_number ILIKE 'BILL-QAC1%' OR s.operational_notes ILIKE 'QA-BUG3%')`;

export const QA_FIXTURE_REGISTRY: QaFixtureSurface[] = [
  {
    table: 'ops_expense_photos',
    label: 'OPS expense photos of QA expenses',
    predicate: `ops_expense_id IN (SELECT id FROM ops_expense_entries WHERE fee_name ILIKE 'QA%' OR expense_type_code ILIKE 'QA%' OR note ILIKE 'QA%' OR ${QA_SHIPMENTS_SQL})`,
    action: 'hard-delete',
    guards: [],
  },
  {
    table: 'ops_expense_entries',
    label: 'OPS expenses (QA-named or on QA shipments)',
    predicate: `fee_name ILIKE 'QA%' OR expense_type_code ILIKE 'QA%' OR note ILIKE 'QA%' OR ${QA_SHIPMENTS_SQL}`,
    action: 'hard-delete-guarded',
    guards: [{ table: 'expense_accounting_sources', column: 'source_id' }],
  },
  {
    table: 'advance_requests',
    label: 'QA advance requests',
    predicate: `reason ILIKE 'QA%' OR requester_name_snapshot ILIKE 'QA%'`,
    action: 'hard-delete-guarded',
    guards: [{ table: 'advance_settlements', column: 'advance_request_id' }, { table: 'advance_settlement_requests', column: 'advance_request_id' }],
  },
  {
    table: 'deposit_refund_trackers',
    label: 'QA deposit-refund tracker rows',
    predicate: `bill_number ILIKE 'QA%' OR bill_number ILIKE 'CARD226-QA-%' OR customer_name ILIKE 'QA%'`,
    action: 'hard-delete-guarded',
    guards: [],
    selfGuard: 'refund_posted_movement_id IS NOT NULL',
  },
  {
    table: 'deposit_refund_trackers',
    label: 'QA-authored notes on surviving tracker rows',
    predicate: `note ILIKE 'QA%'`,
    action: 'scrub',
    guards: [],
    scrubColumns: ['note'],
  },
  {
    table: 'invoice_tracking',
    label: 'QA invoice-tracking rows',
    predicate: `invoice_number ILIKE 'QA%' OR note ILIKE 'QA%'`,
    action: 'soft-delete',
    guards: [],
  },
  {
    table: 'trip_expenses',
    label: 'Trip expenses (QA-named or on QA shipments)',
    predicate: `expense_type ILIKE 'QA%' OR note ILIKE 'QA%' OR ${QA_TRIPS_SQL}`,
    action: 'soft-delete',
    guards: [],
  },
  {
    table: 'treasury_movements',
    label: 'QA treasury movements',
    predicate: `physical_reference ILIKE 'QA%' OR external_reference ILIKE 'QA%'`,
    action: 'hard-delete-guarded',
    guards: [{ table: 'deposit_refund_trackers', column: 'refund_posted_movement_id' }],
  },
  {
    table: 'payment_receipts',
    label: 'QA payment receipts',
    predicate: `receipt_id ILIKE 'QA%'`,
    action: 'hard-delete-guarded',
    guards: [{ table: 'payment_allocations', column: 'payment_receipt_id' }, { table: 'treasury_movements', column: 'payment_receipt_id' }],
  },
  {
    table: 'treasury_accounts',
    label: 'QA treasury accounts',
    predicate: `code ILIKE 'QA%' OR name ILIKE 'QA%'`,
    action: 'deactivate',
    guards: [],
  },
  {
    table: 'shipment_containers',
    label: 'QA container rows (QATU/QAUI...)',
    predicate: `container_number ILIKE 'QA%'`,
    action: 'hard-delete-guarded',
    guards: [{ table: 'ops_expense_entries', column: 'shipment_container_id' }, { table: 'trip_containers', column: 'shipment_container_id' }, { table: 'trip_expenses', column: 'trip_container_id' }],
  },
  {
    table: 'shipments',
    label: 'QA shipments (QA bill/booking refs)',
    predicate: QA_SHIPMENT_FIELDS_SQL,
    action: 'soft-delete',
    guards: [],
  },
  {
    table: 'quotations',
    label: 'QA quotation frames',
    predicate: `note ILIKE 'QA%' OR template_name ILIKE 'QA%'`,
    action: 'soft-delete',
    guards: [],
  },
  {
    table: 'customers',
    label: 'QA customers',
    predicate: `name ILIKE 'QA%'`,
    action: 'soft-delete',
    guards: [],
  },
  {
    table: 'suppliers',
    label: 'QA suppliers',
    predicate: `name ILIKE 'QA%'`,
    action: 'soft-delete',
    guards: [],
  },
  {
    table: 'users',
    label: 'QA users',
    predicate: `username ILIKE 'qa%' OR full_name ILIKE 'QA%'`,
    action: 'soft-delete',
    guards: [],
  },
  {
    table: 'forwarder_expense_types',
    label: 'QA expense-type catalog rows',
    predicate: `code ILIKE 'QA%' OR name ILIKE 'QA%'`,
    action: 'deactivate-plus-soft-delete',
    guards: [],
  },
  {
    table: 'trips',
    label: 'QA text fields on trips (references, notes, factory names)',
    predicate: `customer_reference ILIKE 'QA%' OR notes ILIKE 'QA%' OR factory_site_address ILIKE 'QA%' OR factory_site_name ILIKE 'QA%'`,
    action: 'scrub',
    guards: [],
    scrubColumns: ['customer_reference', 'notes', 'factory_site_address', 'factory_site_name'],
  },
  {
    table: 'shipments',
    label: 'QA text fields on shipments (notes, factory name)',
    predicate: `operational_notes ILIKE 'QA%' OR customer_notes ILIKE 'QA%' OR factory_name ILIKE 'QA%'`,
    action: 'scrub',
    guards: [],
    scrubColumns: ['operational_notes', 'customer_notes', 'factory_name'],
  },
  {
    table: 'trip_containers',
    label: 'QA notes on trip containers',
    predicate: `notes ILIKE 'QA%'`,
    action: 'scrub',
    guards: [],
    scrubColumns: ['notes'],
  },
];

/** Surfaces whose purge must run before this surface, by table name. */
export const PURGE_ORDER_NOTE = 'children before parents; see array order';

/** Table names in registry order. */
export function registryTables(): string[] {
  return QA_FIXTURE_REGISTRY.map((surface) => surface.table);
}
