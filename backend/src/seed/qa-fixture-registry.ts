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

export const QA_SHIPMENT_FIELDS_SQL = `bl_number ILIKE 'QA%' OR booking_ref ILIKE 'QA%' OR shipment_code ILIKE 'QA%' OR bl_number ILIKE 'CARD226-QA-%' OR bl_number ILIKE 'BILL-QAC1%' OR operational_notes ILIKE 'QA-BUG3%' OR operational_notes ILIKE 'card226 advisory-lock probe%'
  /* FB-061 (card 141026012010): the Kiểm soát phơi phiếu board showed
     "BL-QAKE-<timestamp>" and "E2E-*" bills. Neither matches a QA% prefix —
     the QA lanes name their lots by probe family — so the shipments soft
     delete never reached them and the board (which filters on
     shipments.deleted_at) kept rendering them. */
  OR bl_number ILIKE 'BL-QAKE%' OR booking_ref ILIKE 'BL-QAKE%' OR shipment_code ILIKE 'BL-QAKE%'
  OR bl_number ILIKE 'E2E-%' OR booking_ref ILIKE 'E2E-%' OR shipment_code ILIKE 'E2E-%'`;
export const QA_SHIPMENTS_SQL = `shipment_id IN (SELECT id FROM shipments WHERE ${QA_SHIPMENT_FIELDS_SQL})`;
const QA_TRIPS_SQL = `trip_id IN (SELECT t.id FROM trips t JOIN shipments s ON s.id = t.shipment_id WHERE s.bl_number ILIKE 'QA%' OR s.booking_ref ILIKE 'QA%' OR s.shipment_code ILIKE 'QA%' OR s.bl_number ILIKE 'CARD226-QA-%' OR s.bl_number ILIKE 'BILL-QAC1%' OR s.operational_notes ILIKE 'QA-BUG3%')`;

/**
 * FB-061 (card 141026012010) — the board's three vehicle columns
 * (biển số / lái xe / nhà vận tải) project from `trip_carrier_info`
 * (external carriers) and from `trucks` / `drivers` (own fleet). None of those
 * three tables had a registry surface, so a probe plate or driver survived
 * every wave's `make qapurge` while the card kept reporting it on
 * `/accounting/phoi-phieu`.
 *
 * The signatures are the ones the card quotes from staging
 * (2026-10-14, admin): plate `99T-99999`, probe plate `51K-PROBE`, driver
 * `Test Driver …`. Each branch is anchored on a QA token or a probe token —
 * no branch matches a real fleet number or a real driver's name.
 */
export const QA_EXTERNAL_CARRIER_SQL = `external_plate_number ILIKE 'QA%' OR external_driver_name ILIKE 'QA%' OR external_plate_number ILIKE '99T-99999' OR external_plate_number ILIKE '51K-PROBE%' OR external_driver_name ILIKE 'Test Driver%'`;
export const QA_TRUCK_SQL = `license_plate ILIKE 'QA%' OR license_plate ILIKE '99T-99999' OR license_plate ILIKE '51K-PROBE%' OR license_plate ~ '-[0-9]{10,13}$'`;
export const QA_DRIVER_SQL = `name ILIKE 'QA%' OR name ILIKE 'Test Driver%' OR name ~ '-[0-9]{10,13}$'`;

export const QA_FIXTURE_REGISTRY: QaFixtureSurface[] = [
  {
    table: 'ops_expense_photos',
    label: 'OPS expense photos of QA expenses',
    predicate: `ops_expense_id IN (SELECT id FROM ops_expense_entries WHERE fee_name ILIKE 'QA%' OR expense_type_code ILIKE 'QA%' OR note ILIKE 'QA%' OR ${QA_SHIPMENTS_SQL})`,
    action: 'hard-delete',
    guards: [],
  },
  {
    // W1 staging QA (2026-10-16): accounting-created entries are wrapped by a
    // source row; without this surface the entries surface guard-skips them
    // (observed in the first W1 purge run: 19 skipped).
    table: 'expense_accounting_sources',
    label: 'QA accounting-expense source rows',
    predicate: `source_id IN (SELECT id FROM ops_expense_entries WHERE fee_name ILIKE 'QA%' OR expense_type_code ILIKE 'QA%' OR note ILIKE 'QA%')`,
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
    // W1 staging QA (2026-10-16): the 2099-12 fixture period is never a real
    // timesheet period. Days cascade on the month row, but the explicit
    // children-first surface keeps the purge census legible.
    table: 'driver_timesheet_days',
    label: 'QA timesheet grid days (2099 fixture period)',
    predicate: `month_id IN (SELECT id FROM driver_timesheet_months WHERE year = 2099)`,
    action: 'hard-delete',
    guards: [],
  },
  {
    table: 'driver_timesheet_months',
    label: 'QA timesheet months (2099 fixture period)',
    predicate: `year = 2099`,
    action: 'hard-delete',
    guards: [],
  },
  {
    // W1 staging QA (2026-10-16): children of the QA advance-request family —
    // the funding/settlement chain the approve flow created.
    table: 'advance_settlement_requests',
    label: 'QA advance settlement allocations',
    predicate: `settlement_id IN (SELECT id FROM advance_settlements WHERE note ILIKE 'QA%') OR advance_request_id IN (SELECT id FROM advance_requests WHERE reason ILIKE 'QA%')`,
    action: 'hard-delete',
    guards: [],
  },
  {
    table: 'advance_settlements',
    label: 'QA advance settlements (QA-named note)',
    predicate: `note ILIKE 'QA%'`,
    action: 'hard-delete-guarded',
    guards: [{ table: 'settlement_expenses', column: 'settlement_id' }],
  },
  {
    // KP-148 funding pair of approved QA advance requests: the treasury OUT
    // row is found through its ledger link (physical_reference is TU-<id>,
    // not QA-prefixed).
    table: 'treasury_movements',
    label: 'QA advance funding treasury OUT rows',
    predicate: `ledger_entry_id IN (SELECT id FROM ledger WHERE note ILIKE '%QA-W1-%')`,
    action: 'hard-delete-guarded',
    guards: [{ table: 'deposit_refund_trackers', column: 'refund_posted_movement_id' }],
  },
  {
    table: 'ledger',
    label: 'QA advance funding ledger rows (QA-W1 in note)',
    predicate: `note ILIKE '%QA-W1-%'`,
    action: 'hard-delete-guarded',
    guards: [{ table: 'treasury_movements', column: 'ledger_entry_id' }],
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
    // Posted rows purge too when their movement carries the fixture signature.
    selfGuard: "refund_posted_movement_id IS NOT NULL AND refund_posted_movement_id NOT IN (SELECT id FROM treasury_movements WHERE physical_reference ILIKE 'QA%' OR external_reference ILIKE 'QA%')",
  },
  {
    table: 'deposit_refund_trackers',
    label: 'QA-authored notes on surviving tracker rows',
    predicate: `note ILIKE 'QA%'`,
    action: 'scrub',
    guards: [],
    scrubColumns: ['note'],
  },
  // FB-061 round 16 (card 121026185570): staging still listed the QA-seeded
  // fuel invoice QA0915-FI-001 — fuel_invoices had no registry surface and
  // the fuel-invoice API has no delete, so the class had no sanctioned purge.
  // Staging census 2026-10-12 (GET /api/finance/fuel-invoices, 3 rows): only
  // the QA% number matched; real invoices use the PL-2026-* format. Children
  // first so the guarded parent delete never orphans an FK.
  {
    table: 'fuel_invoice_allocations',
    label: 'Fuel allocations of QA fuel invoices',
    predicate: `fuel_invoice_id IN (SELECT id FROM fuel_invoices WHERE invoice_number ILIKE 'QA%' OR note ILIKE 'QA%')`,
    action: 'hard-delete',
    guards: [],
  },
  {
    table: 'fuel_period_adjustments',
    label: 'Fuel period adjustments of QA fuel invoices',
    predicate: `fuel_invoice_id IN (SELECT id FROM fuel_invoices WHERE invoice_number ILIKE 'QA%' OR note ILIKE 'QA%')`,
    action: 'hard-delete',
    guards: [],
  },
  {
    table: 'fuel_invoices',
    label: 'QA fuel invoices (payables "Hóa đơn xăng dầu")',
    predicate: `invoice_number ILIKE 'QA%' OR note ILIKE 'QA%'`,
    action: 'hard-delete-guarded',
    guards: [
      { table: 'fuel_invoice_allocations', column: 'fuel_invoice_id' },
      { table: 'fuel_period_adjustments', column: 'fuel_invoice_id' },
    ],
  },
  {
    table: 'invoice_tracking',
    label: 'QA invoice-tracking rows',
    predicate: `invoice_number ILIKE 'QA%' OR note ILIKE 'QA%'`,
    action: 'soft-delete',
    guards: [],
  },
  {
    // Ticket "QAC1 KH CLOSE 0919" (2026-10-14, FB-061 cousin): the QA close
    // rung authored DEBIT_NOTE billing_documents for a QA-named customer
    // (entity_name 'QAC1 KH CLOSE 0919', ids 16/17/21 on staging) and every
    // purge skipped the table — no surface existed, so the customer's name
    // stayed visible on the debit-note views long after the customer itself
    // was soft-deleted. Lines go first (leaf children, nothing references
    // them); the documents then soft-delete like the other AR-adjacent
    // surfaces so payment_allocations / shipment_accounting_locks /
    // customer_email_logs FKs stay valid. The QA-prefix class is verified by
    // enumeration: real debit notes name real customers, never 'QA%'.
    table: 'billing_document_lines',
    label: 'Billing document lines of QA debit notes',
    predicate: `document_id IN (SELECT id FROM billing_documents WHERE entity_name ILIKE 'QA%' OR note ILIKE 'QA%')`,
    action: 'hard-delete',
    guards: [],
  },
  {
    table: 'billing_documents',
    label: 'QA debit notes / billing documents (entity_name or note)',
    predicate: `entity_name ILIKE 'QA%' OR note ILIKE 'QA%'`,
    action: 'soft-delete',
    guards: [],
  },
  {
    // Same ticket: the QA close rung also authored a dispatch zone
    // ("QAC1 Vùng QA-P3B") that surfaced in zone pickers. FK-pinned master
    // data is renamed in place (ports/operational_sites treatment): the label
    // scrubs to 'Chưa xác định', the boundary-validation code stays.
    table: 'dispatch_zones',
    label: 'QA-named dispatch zones',
    predicate: `label ILIKE 'QA%' OR code ILIKE 'QA%'`,
    action: 'scrub',
    guards: [],
    scrubColumns: ['label'],
  },
  {
    table: 'trip_expenses',
    label: 'Trip expenses (QA-named or on QA shipments)',
    predicate: `expense_type ILIKE 'QA%' OR note ILIKE 'QA%' OR ${QA_TRIPS_SQL}`,
    action: 'soft-delete',
    guards: [],
  },
  {
    table: 'ledger',
    label: 'QA-signed ledger adjustments (QA0922 fixture family in note)',
    predicate: `note ILIKE '%QA0922-%'`,
    action: 'hard-delete-guarded',
    guards: [{ table: 'treasury_movements', column: 'ledger_entry_id' }],
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
    // FB-061 (card 141026012010): the board also showed "QA0915 QA-138 Credit
    // Customer" (matches QA%) and the probe carrier family "STG VERIFY …"
    // (does not). The customers join on the board filters deleted_at, so a
    // soft delete removes the name from every projection that uses it.
    predicate: `name ILIKE 'QA%' OR name ILIKE 'STG VERIFY%'`,
    action: 'soft-delete',
    guards: [],
  },
  {
    table: 'suppliers',
    label: 'QA suppliers',
    predicate: `name ILIKE 'QA%' OR name ILIKE 'STG VERIFY%'`,
    action: 'soft-delete',
    guards: [],
  },
  {
    table: 'users',
    label: 'QA users',
    // The original `qa%` rule matched nothing: every QA lane names its
    // fixtures `<purpose>-<epoch-ms>-<rand>` (card8-, c5-, adc-, e2e-,
    // ops-portal-, clerk-unscoped-, cus-inv-…), so the local dev DB reached
    // 899 users of which ~890 were fixtures, and the users page paginated
    // them into a 500-row cap. `-[0-9]{13}-` is the run-scoped signature and
    // cannot match the real roster, whose names are name-based (thanhdc,
    // dungnv, giamdoc) and never carry a 13-digit epoch stamp.
    predicate: `username ILIKE 'qa%' OR full_name ILIKE 'QA%' OR username ~ '-[0-9]{13}-' OR username ILIKE '%-inv-%'`,
    action: 'soft-delete',
    // Never purge a user another row still points at: a live shipment link or
    // an assigned truck means the row is load-bearing, not leftover.
    guards: [
      { table: 'user_shipment_links', column: 'user_id' },
      { table: 'truck_accountant_assignments', column: 'accountant_id' },
    ],
  },
  {
    table: 'business_units',
    label: 'QA-named business units (Bộ phận in /hr/roster)',
    // FB-061 round 14: QA units surfaced in the roster's Bộ phận column
    // ("QA Audit Unit 0914"). business_units was absent from this registry
    // entirely, so no QA unit was ever a purge candidate.
    // Staging enumeration 2026-10-12 (GET /api/auth/business-units, 6 rows):
    // 5 match this predicate (QA085-RENAMED-755742, QA-17 audit unit…,
    // QA2-26SEP Unit 1, QA Audit Unit 0914, QA R6 085 unit EDITED) and the
    // single real unit (CUS-DEMO / "Đơn vị CUS Demo") does not. The real
    // roster is name-based and never carries a QA token.
    predicate: `name ILIKE 'QA%' OR code ILIKE 'QA%'`,
    // NOT 'scrub': business_units_name_uniq_idx is UNIQUE on name and name is
    // NOT NULL, so collapsing the rows to one placeholder would violate the
    // index. user_business_unit_links pins these ids, so deactivating in place
    // keeps the FK valid — the treatment QA already applied to ids 2 and 3.
    action: 'deactivate',
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
    predicate: `customer_reference ILIKE 'QA%' OR notes ILIKE 'QA%' OR factory_site_address ILIKE 'QA%' OR factory_site_name ILIKE 'QA%' OR factory_site_name ILIKE 'KHO-SEAM%'`,
    action: 'scrub',
    guards: [],
    scrubColumns: ['customer_reference', 'notes', 'factory_site_address', 'factory_site_name'],
  },
  {
    table: 'shipments',
    label: 'QA text fields on shipments (notes, factory name)',
    // FB-061 round 14: the FB-080 rung family names its rows "FB080-RUNG-<n>"
    // in bl_number and "FB-080 rung …" in factory_name, so it never matched
    // the QA% rule and survived as a visible lot name on /shipments.
    // Enumeration 2026-10-12 (GET /api/shipments): the FB08%RUNG% branch
    // matches exactly ids 436/437 (FB080-RUNG-1 "FB-080 rung", FB080-RUNG-2
    // "FB-080 rung minimal"). Real factory names in the same census
    // ("Nhà máy YuanFang", "SJ", "Chưa xác định") match no branch.
    predicate: `operational_notes ILIKE 'QA%' OR customer_notes ILIKE 'QA%' OR factory_name ILIKE 'QA%' OR bl_number ILIKE 'FB08%RUNG%' OR factory_name ILIKE 'FB-0% rung%'
      /* FB-061 (card 141026012010): "KHO-SEAM-1789702634486" — a probe site
         name stamped with an epoch, shown as the board's Nhà máy. */
      OR factory_name ILIKE 'KHO-SEAM%'`,
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
  {
    table: 'trip_carrier_info',
    label: 'QA external-carrier rows (probe plate / driver on Kiểm soát phơi phiếu)',
    // FB-061 (card 141026012010): one child of trips, and the source of the
    // board's biển số / lái xe / nhà vận tải columns for EXTERNAL carriers.
    // No deleted_at and no status column, so the row cannot be hidden — it
    // must go, and it goes before its trip's other children.
    predicate: QA_EXTERNAL_CARRIER_SQL,
    action: 'hard-delete',
    guards: [],
  },
  {
    table: 'trucks',
    label: 'QA probe trucks (own-fleet plate on Kiểm soát phơi phiếu)',
    // Soft delete, not delete: trips.truck_id is a bare integer with no DB FK,
    // so a hard delete would orphan live trip rows. See the record's note on
    // the board's left join.
    predicate: QA_TRUCK_SQL,
    action: 'soft-delete',
    guards: [],
  },
  {
    table: 'drivers',
    label: 'QA probe drivers (own-fleet driver on Kiểm soát phơi phiếu)',
    predicate: QA_DRIVER_SQL,
    action: 'soft-delete',
    guards: [],
  },
  {
    table: 'operational_sites',
    label: 'QA-named operational sites (FK-pinned master data - renamed in place)',
    // FB-061 (card 141026012010): `code` was never in the predicate, so a
    // probe site whose NAME reads like a real factory while its CODE carries
    // the probe token survived; and the card's visible value was a
    // name-stamped `KHO-SEAM-<epoch>` on both columns.
    predicate: `name ILIKE 'QA%' OR short_name ILIKE 'QA%' OR code ILIKE 'QA%' OR name ILIKE 'KHO-SEAM%' OR short_name ILIKE 'KHO-SEAM%'`,
    action: 'scrub',
    guards: [],
    scrubColumns: ['name', 'short_name'],
  },
  {
    table: 'ports',
    label: 'QA-named ports and dispatch zones (FK-pinned master data - renamed in place)',
    predicate: `name ILIKE '%QA%' OR code ILIKE '%QA%' OR dispatch_zone ILIKE '%QA%'`,
    action: 'scrub',
    guards: [],
    scrubColumns: ['name', 'dispatch_zone'],
  },
  {
    table: 'distributions',
    label: 'QA profit distribution rows',
    predicate: `partner_name ILIKE 'QA%' OR partner_name ILIKE '%dbapi%'`,
    action: 'hard-delete',
    guards: [],
  },
  {
    table: 'penalty_reasons',
    label: 'QA penalty reason catalog rows',
    predicate: `reason_text ILIKE 'QA%' OR reason_text ILIKE '%staging%'`,
    action: 'soft-delete',
    guards: [],
  },
  {
    table: 'driver_incidental_costs',
    label: 'QA text fields on driver incidental costs',
    predicate: `fee_name ILIKE 'QA%' OR fee_name ILIKE 'TEST%' OR note ILIKE 'QA%' OR note ILIKE 'TEST%'`,
    action: 'scrub',
    guards: [],
    scrubColumns: ['fee_name', 'note'],
  },
];

/** Surfaces whose purge must run before this surface, by table name. */
export const PURGE_ORDER_NOTE = 'children before parents; see array order';

/** Table names in registry order. */
export function registryTables(): string[] {
  return QA_FIXTURE_REGISTRY.map((surface) => surface.table);
}
