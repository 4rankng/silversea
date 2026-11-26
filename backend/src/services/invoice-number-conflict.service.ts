import { and, asc, eq, isNotNull, isNull, ne, notInArray, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import * as s from '../db/schema';
import { db, type Executor } from '../db';
import { ApiError, isPgUniqueViolation } from '../errors';
import { normalizeOpsInvoiceNumber } from './ops-invoice-number';
import { acquireAdvisoryLock, lockKeys } from './advisory-lock.service';

/** SIL-1101 (K2.119) — a Số hóa đơn is a HARD identity key across the WHOLE
 *  expense ledger, not per-lô. One paper invoice that lands on lot A's trip
 *  and again on lot B's trip mints two payment obligations for the same
 *  document — the exact duplicate-payment harm the QA repro (QA-R2F2-119 on
 *  lô 547/548, trip-cost rows 59/60) pinned. Creation on ANY lane refuses
 *  with a 400 that names the conflicting lot/trip, mirroring the
 *  declarationNumber conflict pattern (findDeclarationReferenceConflict +
 *  throwShipmentReferenceConflict): same fold, same lookup, message carries
 *  the document and its existing owner.
 *
 *  Live rows are scanned in the three native stores (the same stores the
 *  writers touch — no expenseAccountingSources invoice mirror exists):
 *  ops_expense_entries, trip_expenses, driver_incidental_costs. Voided or
 *  rejected rows never conflict. Comparison is the site-wide case/space-
 *  insensitive fold (' TD-001 ' ≡ 'td-001'), same as the per-lô gate.
 *
 *  Leaf module: imports only the pure invoice-number law + schema + the leaf
 *  advisory-lock module + the shared pool (the 23505 catch-time re-read —
 *  the caller's transaction is aborted by then), so both writers
 *  (ops-expenses.service and expense-accounting-create.service) can sit on
 *  it without a cycle. */

export interface InvoiceNumberConflict {
  invoiceNumber: string;
  shipmentId: number | null;
  shipmentCode: string | null;
  tripId: number | null;
  tripCode: string | null;
}

/** One candidate row as the lookup selects it; the caller passes rows in
 *  store order (ops → trip → driver), each already in id order. */
export type InvoiceNumberCandidate = Omit<InvoiceNumberConflict, 'invoiceNumber'> & {
  invoiceNumber: string | null;
};

/** Pure pick: the first live row whose folded number equals the entered one.
 *  Deterministic headless seam for the unit law; the SQL queries feed it. */
export function pickInvoiceNumberConflict(
  candidates: ReadonlyArray<InvoiceNumberCandidate>,
  invoiceNumber: string,
): InvoiceNumberConflict | null {
  const normalized = normalizeOpsInvoiceNumber(invoiceNumber);
  if (normalized === '') return null;
  for (const row of candidates) {
    if (row.invoiceNumber != null && normalizeOpsInvoiceNumber(row.invoiceNumber) === normalized) {
      return {
        invoiceNumber: row.invoiceNumber,
        shipmentId: row.shipmentId ?? null,
        shipmentCode: row.shipmentCode ?? null,
        tripId: row.tripId ?? null,
        tripCode: row.tripCode ?? null,
      };
    }
  }
  return null;
}

/** SIL-1101 — the 400 message names the invoice number and the lot/trip that
 *  already holds it, matching the Vietnamese naming style of the per-lô
 *  duplicate law ('Số hóa đơn X đã tồn tại trên lô này.'). */
export function invoiceNumberConflictMessage(conflict: InvoiceNumberConflict): string {
  const scopes: string[] = [];
  if (conflict.shipmentCode) scopes.push(`lô ${conflict.shipmentCode}`);
  if (conflict.tripCode) scopes.push(`chuyến ${conflict.tripCode}`);
  if (scopes.length === 0) return `Số hóa đơn ${conflict.invoiceNumber} đã tồn tại trong hệ thống.`;
  return `Số hóa đơn ${conflict.invoiceNumber} đã tồn tại trên ${scopes.join(', ')}.`;
}

const INVOICE_FOLD = (column: SQL | AnyColumn) => sql`regexp_replace(lower(${column}), '[[:space:]]+', '', 'g')`;

export async function findInvoiceNumberConflict(
  tx: Executor,
  invoiceNumber: string,
  opts: { excludeShipmentId?: number; excludeInvoiceTrackingId?: number; excludeTripExpenseId?: number } = {},
): Promise<InvoiceNumberConflict | null> {
  const normalized = normalizeOpsInvoiceNumber(invoiceNumber);
  if (normalized === '') return null;
  const excludeShipmentId = opts.excludeShipmentId;

  // The Theo dõi hóa đơn board (SIL-1101's actual QA surface): the accountant
  // fills Số HD per row and each row carries its own Trả NCC payment
  // obligation, so two rows with one number = two payments for one document.
  const [trackingHit] = await tx
    .select({
      invoiceNumber: s.invoiceTracking.invoiceNumber,
      shipmentId: s.invoiceTracking.shipmentId,
      shipmentCode: s.shipments.shipmentCode,
      tripId: s.invoiceTracking.tripId,
      tripCode: s.trips.tripCode,
    })
    .from(s.invoiceTracking)
    .leftJoin(s.shipments, eq(s.shipments.id, s.invoiceTracking.shipmentId))
    .leftJoin(s.trips, eq(s.trips.id, s.invoiceTracking.tripId))
    .where(and(
      isNotNull(s.invoiceTracking.invoiceNumber),
      isNull(s.invoiceTracking.deletedAt),
      opts.excludeInvoiceTrackingId != null ? ne(s.invoiceTracking.id, opts.excludeInvoiceTrackingId) : undefined,
      sql`${INVOICE_FOLD(s.invoiceTracking.invoiceNumber)} = ${normalized}`,
    ))
    .orderBy(asc(s.invoiceTracking.id))
    .limit(1);
  if (trackingHit) return pickInvoiceNumberConflict([trackingHit], invoiceNumber);

  const [opsHit] = await tx
    .select({
      invoiceNumber: s.opsExpenseEntries.invoiceNumber,
      shipmentId: s.opsExpenseEntries.shipmentId,
      shipmentCode: s.shipments.shipmentCode,
      tripId: sql<number | null>`null`,
      tripCode: sql<string | null>`null`,
    })
    .from(s.opsExpenseEntries)
    .leftJoin(s.shipments, eq(s.shipments.id, s.opsExpenseEntries.shipmentId))
    .where(and(
      isNotNull(s.opsExpenseEntries.invoiceNumber),
      notInArray(s.opsExpenseEntries.approvalStatus, ['VOIDED', 'REJECTED']),
      excludeShipmentId != null ? ne(s.opsExpenseEntries.shipmentId, excludeShipmentId) : undefined,
      sql`${INVOICE_FOLD(s.opsExpenseEntries.invoiceNumber)} = ${normalized}`,
    ))
    .orderBy(asc(s.opsExpenseEntries.id))
    .limit(1);
  if (opsHit) return pickInvoiceNumberConflict([opsHit], invoiceNumber);

  const [tripHit] = await tx
    .select({
      invoiceNumber: s.tripExpenses.invoiceNumber,
      shipmentId: s.expenseAccountingSources.shipmentId,
      shipmentCode: s.shipments.shipmentCode,
      tripId: s.tripExpenses.tripId,
      tripCode: s.trips.tripCode,
    })
    .from(s.tripExpenses)
    .innerJoin(s.trips, eq(s.trips.id, s.tripExpenses.tripId))
    .leftJoin(s.expenseAccountingSources, and(
      eq(s.expenseAccountingSources.sourceKind, 'TRIP'),
      eq(s.expenseAccountingSources.linkedTripExpenseId, s.tripExpenses.id),
    ))
    .leftJoin(s.shipments, eq(s.shipments.id, s.expenseAccountingSources.shipmentId))
    .where(and(
      isNotNull(s.tripExpenses.invoiceNumber),
      notInArray(s.tripExpenses.approvalStatus, ['VOIDED', 'REJECTED']),
      opts.excludeTripExpenseId != null ? ne(s.tripExpenses.id, opts.excludeTripExpenseId) : undefined,
      excludeShipmentId != null ? ne(s.expenseAccountingSources.shipmentId, excludeShipmentId) : undefined,
      sql`${INVOICE_FOLD(s.tripExpenses.invoiceNumber)} = ${normalized}`,
    ))
    .orderBy(asc(s.tripExpenses.id))
    .limit(1);
  if (tripHit) return pickInvoiceNumberConflict([tripHit], invoiceNumber);

  const [driverHit] = await tx
    .select({
      invoiceNumber: s.driverIncidentalCosts.invoiceNumber,
      shipmentId: s.expenseAccountingSources.shipmentId,
      shipmentCode: s.shipments.shipmentCode,
      tripId: s.driverIncidentalCosts.tripId,
      tripCode: s.trips.tripCode,
    })
    .from(s.driverIncidentalCosts)
    .innerJoin(s.trips, eq(s.trips.id, s.driverIncidentalCosts.tripId))
    .leftJoin(s.expenseAccountingSources, and(
      eq(s.expenseAccountingSources.sourceKind, 'DRIVER'),
      eq(s.expenseAccountingSources.sourceId, s.driverIncidentalCosts.id),
    ))
    .leftJoin(s.shipments, eq(s.shipments.id, s.expenseAccountingSources.shipmentId))
    .where(and(
      isNotNull(s.driverIncidentalCosts.invoiceNumber),
      excludeShipmentId != null ? ne(s.expenseAccountingSources.shipmentId, excludeShipmentId) : undefined,
      sql`${INVOICE_FOLD(s.driverIncidentalCosts.invoiceNumber)} = ${normalized}`,
    ))
    .orderBy(asc(s.driverIncidentalCosts.id))
    .limit(1);
  if (driverHit) return pickInvoiceNumberConflict([driverHit], invoiceNumber);

  return null;
}

/** True when a thrown error is the 23505 of one of the SIL-1109 folded
 *  invoice-number partial unique indexes (the four *_live_invoice_number_key
 *  indexes). Pure predicate over the Drizzle-wrapped PG error shapes. */
export function isInvoiceNumberUniqueViolation(err: unknown): boolean {
  return isPgUniqueViolation(err, 'invoice_number_key');
}

/** SIL-1109 — wraps an invoice-bearing INSERT/UPDATE so the DB-level refusal
 *  of the SIL-1109 unique indexes lands as the SAME 400 the SIL-1101 guard
 *  throws: the Vietnamese message naming the live lot/trip owner, never the
 *  raw PG text. A non-invoice 23505 (or any other error) is rethrown
 *  untouched. `invoiceNumber` is the number this statement writes — null
 *  writes can never hit the partial indexes, so a null simply rethrows.
 *
 *  The conflicting row is COMMITTED by definition (unique indexes see only
 *  committed rows plus own-tx rows, and an own-tx row cannot duplicate
 *  itself), while the 23505 has aborted the caller's transaction — any
 *  statement re-read on it would raise 25P02. The owner lookup therefore
 *  runs on the pool: a fresh READ COMMITTED snapshot that names the true
 *  lot/trip holder. When even that finds nothing (index/exotic edge), the
 *  ledger-law generic message still refuses with the number, never DB text. */
export async function withInvoiceNumberUniqueGuard<T>(
  invoiceNumber: string | null | undefined,
  run: () => Promise<T>,
  opts: { excludeShipmentId?: number; excludeInvoiceTrackingId?: number; excludeTripExpenseId?: number } = {},
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (invoiceNumber == null || !isInvoiceNumberUniqueViolation(err)) throw err;
    const conflict = await findInvoiceNumberConflict(db, invoiceNumber, opts);
    throw new ApiError(
      400,
      conflict ? invoiceNumberConflictMessage(conflict) : `Số hóa đơn ${invoiceNumber} đã tồn tại trong hệ thống.`,
      undefined,
      { code: 'EXPENSE_INVOICE_NUMBER_CONFLICT' },
    );
  }
}

/** Creation guard: throw the SIL-1101 400 naming the existing owner when the
 *  entered number is already live anywhere in the ledger. Runs inside the
 *  caller's executor so the refused save rolls back atomically.
 *
 *  SIL-1109 — the check-then-insert window is closed FIRST: the transaction
 *  takes the folded-number advisory lock before the lookups, so a concurrent
 *  same-number creation (any of the 4 stores, any two lots) blocks until the
 *  first transaction commits and this re-read then sees its row. Every
 *  guarded lane runs inside a real transaction (runShipmentWrite /
 *  runIdempotent / runInTx), which is what gives the xact lock its lifetime. */
export async function assertInvoiceNumberAvailable(
  tx: Executor,
  invoiceNumber: string | null | undefined,
  opts: { excludeShipmentId?: number; excludeInvoiceTrackingId?: number; excludeTripExpenseId?: number } = {},
): Promise<void> {
  if (invoiceNumber == null) return;
  const normalized = normalizeOpsInvoiceNumber(invoiceNumber);
  if (normalized === '') return;
  await acquireAdvisoryLock(tx, lockKeys.invoiceNumber(normalized));
  const conflict = await findInvoiceNumberConflict(tx, invoiceNumber, opts);
  if (conflict) {
    throw new ApiError(
      400,
      invoiceNumberConflictMessage(conflict),
      undefined,
      { code: 'EXPENSE_INVOICE_NUMBER_CONFLICT', conflict },
    );
  }
}
