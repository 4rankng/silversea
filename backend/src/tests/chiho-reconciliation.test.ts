import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray } from 'drizzle-orm';
import { TripStatus, Role, TxnType, FuelMode, LoadingType } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import { transitionTripStatus } from '../services/trip-status-machine.service';
import { generateDraft } from '../services/billingDocument.service';
import { getTopOverdueCustomer, getCustomerAgingList } from '../services/aging.service';
import {
  exportStatementXlsx,
  getStatementData,
} from '../services/statement.service';
import { updateTripExpense, createTripExpense } from '../services/forwarder.service';
import { updateTripFigures } from '../services/trip-mutations.service';
import { LedgerService } from '../services/ledger.service';
import { ApiError } from '../errors';
import { disconnectRedis, invalidateReportCaches } from '../lib/redis';

/**
 * US-007 — final-gate chi hộ reconciliation & regression tests.
 *
 * These tests prove the headline property of the chi hộ AR feature:
 *   For trips whose departureDate AND lock-time fall in a query window,
 *   Σ(customer ledger debits where txn_type ∈ {TRIP_REVENUE, SERVICE_FEE})
 *   == the debt-notice totalInclVat for the same window.
 *
 * They also lock down the cross-boundary divergence, the statement XLSX
 * label, the LOCKED-immutability prerequisite, and aging inclusion.
 *
 * Pattern mirrors ledger.service.chiho.test.ts: real Postgres, drive state
 * transitions through the status machine, clean up created rows in `after`.
 */

const createdTripIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdSupplierIds: number[] = [];
const createdForwarderIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdExpenseIds: number[] = [];

after(async () => {
  const allTxnIds = [...createdTripIds, ...createdExpenseIds];
  if (allTxnIds.length > 0) {
    await db.delete(s.ledger).where(inArray(s.ledger.txnId, allTxnIds));
  }
  if (createdExpenseIds.length > 0) {
    await db.delete(s.tripExpenses).where(inArray(s.tripExpenses.id, createdExpenseIds));
  }
  if (createdTripIds.length > 0) {
    // updateTripFigures replaces the trip's legs. They do not cascade when the
    // parent trip is deleted, so remove them explicitly to keep teardown from
    // aborting before the shared database connection can be closed.
    await db.delete(s.tripLegs).where(inArray(s.tripLegs.tripId, createdTripIds));
    await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
  }
  if (createdForwarderIds.length > 0) {
    await db.delete(s.users).where(inArray(s.users.id, createdForwarderIds));
  }
  if (createdSupplierIds.length > 0) {
    await db.delete(s.suppliers).where(inArray(s.suppliers.id, createdSupplierIds));
  }
  if (createdCustomerIds.length > 0) {
    await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
  }
  if (createdRouteIds.length > 0) {
    await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
  }
  if (createdCargoTypeIds.length > 0) {
    await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, createdCargoTypeIds));
  }
  await invalidateReportCaches();
  await disconnectRedis();
  await client.end();
});

interface FeeSpec {
  buyAmount: number;
  sellAmount: number;
  settlementMethod: 'COMPANY_DIRECT' | 'FORWARDER_ADVANCE';
  supplierId?: number;
  forwarderId?: number;
  approvalStatus?: string;
  expenseType?: string;
}

interface TripSpec {
  revenue: number;
  departureDate: string; // YYYY-MM-DD — must fall in the query window for the clean case
  fees: FeeSpec[];
  /** When false, leave the trip COMPLETED instead of transitioning to LOCKED.
   *  Exercises the COMPLETED-only billable path (the /debt/2 fix). Default true. */
  lock?: boolean;
}

async function createLockedTripWithFees(spec: TripSpec) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const [customer] = await db.insert(s.customers)
    .values({ name: `Recon customer ${suffix}` }).returning();
  const [route] = await db.insert(s.routes)
    .values({ name: `Recon route ${suffix}` }).returning();
  const [cargoType] = await db.insert(s.cargoTypes)
    .values({ name: `Recon cargo ${suffix}` }).returning();
  createdCustomerIds.push(customer.id);
  createdRouteIds.push(route.id);
  createdCargoTypeIds.push(cargoType.id);

  let supplierId: number | undefined;
  let forwarderId: number | undefined;
  if (spec.fees.some(f => f.settlementMethod === 'COMPANY_DIRECT')) {
    const [supplier] = await db.insert(s.suppliers)
      .values({ name: `Recon supplier ${suffix}` }).returning();
    supplierId = supplier.id;
    createdSupplierIds.push(supplierId);
  }
  if (spec.fees.some(f => f.settlementMethod === 'FORWARDER_ADVANCE')) {
    const [fwd] = await db.insert(s.users)
      .values({
        username: `recon-fwd-${suffix}`.slice(0, 50),
        passwordHash: 'x',
        fullName: `Recon forwarder ${suffix}`,
        role: 'DRIVER',
        status: 'ACTIVE',
      }).returning();
    forwarderId = fwd.id;
    createdForwarderIds.push(forwarderId);
  }

  const [trip] = await db.insert(s.trips).values({
    tripCode: `RC-${suffix}`.slice(0, 50),
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    status: TripStatus.IN_TRANSIT,
    departureDate: spec.departureDate,
    revenue: String(spec.revenue),
    carrierType: 'OWN',
  }).returning();
  createdTripIds.push(trip.id);

  const expenseRows: Array<typeof s.tripExpenses.$inferSelect> = [];
  for (const fee of spec.fees) {
    const [row] = await db.insert(s.tripExpenses).values({
      tripId: trip.id,
      forwarderId: fee.settlementMethod === 'FORWARDER_ADVANCE' ? (fee.forwarderId ?? forwarderId!) : null,
      expenseType: fee.expenseType ?? 'CHI_HO',
      buyAmount: String(fee.buyAmount),
      sellAmount: String(fee.sellAmount),
      settlementMethod: fee.settlementMethod,
      supplierId: fee.settlementMethod === 'COMPANY_DIRECT' ? (fee.supplierId ?? supplierId!) : null,
      approvalStatus: fee.approvalStatus ?? 'APPROVED',
    }).returning();
    expenseRows.push(row);
    createdExpenseIds.push(row.id);
  }

  // IN_TRANSIT → COMPLETED posts the ledger (postTripLock). The debt notice now
  // bills COMPLETED + LOCKED (revenue posts at completion; LOCKED is just a
  // figures-freeze), so the trip surfaces on the note at COMPLETED already.
  await transitionTripStatus(trip.id, TripStatus.COMPLETED, 1, Role.MANAGER);
  if (spec.lock !== false) {
    // Optional "chốt" freeze — still billable; exercised by the legacy LOCKED cases.
    await transitionTripStatus(trip.id, TripStatus.LOCKED, 1, Role.MANAGER, true, true);
  }

  return { trip, customer, supplierId, forwarderId, expenseRows, customerName: customer.name };
}

/** Sum of CUSTOMER ledger debits for txnTypes {TRIP_REVENUE, SERVICE_FEE}. */
async function customerARFromLedger(customerId: number): Promise<number> {
  const rows = await db.select({ debit: s.ledger.debit, txnType: s.ledger.txnType })
    .from(s.ledger)
    .where(and(
      eq(s.ledger.entityType, 'CUSTOMER'),
      eq(s.ledger.entityId, customerId),
      inArray(s.ledger.txnType, [TxnType.TRIP_REVENUE, TxnType.SERVICE_FEE]),
    ));
  return rows.reduce((acc, r) => acc + Number(r.debit ?? 0), 0);
}

describe('US-007 chi hộ reconciliation: ledger AR == debit-note total', () => {
  test('CLEAN window: Σ(TRIP_REVENUE + SERVICE_FEE debits) == debit-note totalInclVat', async () => {
    // Window covers all of 2026-06. Two LOCKED trips, departureDate inside,
    // lock time inside (posted at NOW() during the test, which is inside).
    const from = '2026-06-01';
    const to = '2026-06-30';

    const t1 = await createLockedTripWithFees({
      revenue: 5_000_000,
      departureDate: '2026-06-15',
      fees: [
        { buyAmount: 100_000, sellAmount: 120_000, settlementMethod: 'FORWARDER_ADVANCE' },
        { buyAmount: 80_000, sellAmount: 95_000, settlementMethod: 'COMPANY_DIRECT' },
      ],
    });
    const t2 = await createLockedTripWithFees({
      revenue: 3_000_000,
      departureDate: '2026-06-20',
      fees: [
        { buyAmount: 50_000, sellAmount: 60_000, settlementMethod: 'COMPANY_DIRECT' },
      ],
    });

    // Both trips belong to the SAME customer? No — createLockedTripWithFees makes
    // a fresh customer each call. For a single debit-note per customer we drive
    // the draft per-customer and sum. The reconciliation property is per-entity.
    const ar1 = await customerARFromLedger(t1.customer.id);
    const ar2 = await customerARFromLedger(t2.customer.id);

    const draft1 = await generateDraft({
      type: 'DEBIT_NOTE', entityType: 'CUSTOMER', entityId: t1.customer.id,
      rangeFrom: from, rangeTo: to,
    });
    const draft2 = await generateDraft({
      type: 'DEBIT_NOTE', entityType: 'CUSTOMER', entityId: t2.customer.id,
      rangeFrom: from, rangeTo: to,
    });

    // Headline property: ledger AR == debit-note total, per customer.
    assert.ok(Math.abs(ar1 - draft1.totalInclVat) <= 1,
      `customer1: ledger AR ${ar1} vs draft ${draft1.totalInclVat} diverge > 1 VND`);
    assert.ok(Math.abs(ar2 - draft2.totalInclVat) <= 1,
      `customer2: ledger AR ${ar2} vs draft ${draft2.totalInclVat} diverge > 1 VND`);

    // Sanity: the expected totals are exactly revenue + sell fees.
    assert.equal(ar1, 5_000_000 + 120_000 + 95_000);
    assert.equal(ar2, 3_000_000 + 60_000);

    // And the draft surfaces a SERVICE_FEE line per fee (not silently dropped).
    const t1FeeLines = draft1.lines.filter(l => l.lineType === 'SERVICE_FEE');
    assert.equal(t1FeeLines.length, 2, 'draft lists both phí chi hộ lines');

    // Regression: freight description must show the route name, NOT the trip
    // code. Previously the code inlined `(${tripCode})`, which rendered as
    // "Cước vận chuyển RC-xxxx" when a route name was missing — customers read
    // the trip code as the destination. The trip code lives in its own column.
    const t1Freight = draft1.lines.find(l => l.lineType === 'FREIGHT');
    assert.ok(t1Freight, 'draft has a freight line');
    assert.match(t1Freight.description, /Cước vận chuyển/,
      'freight description leads with "Cước vận chuyển"');
    assert.doesNotMatch(t1Freight.description, /RC-/,
      'freight description must NOT inline the trip code (RC-…) — it has its own chứng từ column');
  });

  test('CROSS-BOUNDARY: trip departureDate outside window → debit-note excludes it, ledger does not', async () => {
    // Trip departs in May (outside the June window) but is LOCKED now (June).
    // The debit-note filters by departureDate in [from,to], so this trip is
    // excluded and the two totals legitimately diverge.
    const from = '2026-06-01';
    const to = '2026-06-30';

    const inWindow = await createLockedTripWithFees({
      revenue: 4_000_000,
      departureDate: '2026-06-10',
      fees: [
        { buyAmount: 70_000, sellAmount: 90_000, settlementMethod: 'COMPANY_DIRECT' },
      ],
    });
    const outOfWindow = await createLockedTripWithFees({
      revenue: 2_000_000,
      departureDate: '2026-05-15', // outside June
      fees: [
        { buyAmount: 40_000, sellAmount: 50_000, settlementMethod: 'COMPANY_DIRECT' },
      ],
    });

    // Ledger AR for the out-of-window customer still includes its trip + fee
    // (the ledger has no date filter — it is the lifetime balance).
    const arOut = await customerARFromLedger(outOfWindow.customer.id);
    assert.equal(arOut, 2_000_000 + 50_000);

    // The debit-note for that customer over the June window is ZERO — the trip
    // departs outside the window so it is not surfaced.
    const draftOut = await generateDraft({
      type: 'DEBIT_NOTE', entityType: 'CUSTOMER', entityId: outOfWindow.customer.id,
      rangeFrom: from, rangeTo: to,
    });
    assert.equal(draftOut.totalInclVat, 0,
      'cross-boundary trip excluded from debit-note by departureDate filter');

    // Lock the signed divergence: ledger AR minus draft total == full trip+fee.
    const divergence = arOut - draftOut.totalInclVat;
    assert.equal(divergence, 2_050_000,
      `cross-boundary divergence locked at trip+fee (2,050,000); got ${divergence}`);

    // The in-window customer still reconciles cleanly.
    const arIn = await customerARFromLedger(inWindow.customer.id);
    const draftIn = await generateDraft({
      type: 'DEBIT_NOTE', entityType: 'CUSTOMER', entityId: inWindow.customer.id,
      rangeFrom: from, rangeTo: to,
    });
    assert.ok(Math.abs(arIn - draftIn.totalInclVat) <= 1,
      `in-window customer still reconciles: ${arIn} vs ${draftIn.totalInclVat}`);
  });
});

describe('US-007 statement XLSX labels SERVICE_FEE as "Phí chi hộ"', () => {
  test('XLSX type column for a SERVICE_FEE ledger row reads "Phí chi hộ" (not "Khác")', async () => {
    const { trip, customer, expenseRows } = await createLockedTripWithFees({
      revenue: 1_000_000,
      departureDate: '2026-06-12',
      fees: [
        { buyAmount: 30_000, sellAmount: 45_000, settlementMethod: 'COMPANY_DIRECT' },
      ],
    });

    // Build the real customer statement (includes the SERVICE_FEE row posted at lock).
    const statement = await getStatementData(customer.id);
    assert.ok(statement, 'statement returned');

    const feeRow = statement.ledgerRows.find(r =>
      r.txnType === TxnType.SERVICE_FEE && r.txnId === expenseRows[0].id
    );
    assert.ok(feeRow, 'SERVICE_FEE ledger row present in statement');

    // Render the statement to XLSX in-memory and inspect the type cell.
    const { PassThrough } = await import('node:stream');
    const chunks: Buffer[] = [];
    const sink = new PassThrough();
    sink.on('data', (c) => chunks.push(Buffer.from(c)));
    const ended = new Promise<void>((resolve, reject) => {
      sink.once('end', resolve);
      sink.once('error', reject);
    });

    await exportStatementXlsx(statement, '2026-06-30', sink);
    sink.end();
    await ended;
    const buf = Buffer.concat(chunks);

    const ExcelJSMod = await import('exceljs');
    const ExcelJS = (ExcelJSMod as Record<string, unknown>).default
      ? ((ExcelJSMod as Record<string, unknown>).default as typeof ExcelJSMod)
      : ExcelJSMod;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];

    // Scan every cell for the literal label. The XLSX builder writes
    // `config.txnLabels[row.txnType]` into the type column; if the map missed
    // SERVICE_FEE it would fall back to 'Khác'. We must NOT see 'Khác' on the
    // fee's row and we MUST see 'Phí chi hộ' somewhere in the sheet.
    const labels: string[] = [];
    ws.eachRow((row) => {
      row.eachCell((cell) => {
        if (typeof cell.value === 'string') labels.push(cell.value);
      });
    });
    assert.ok(labels.includes('Phí chi hộ'),
      'XLSX contains the "Phí chi hộ" label');
    assert.ok(!labels.includes('Khác'),
      'no SERVICE_FEE row fell back to the "Khác" default');

    // Reference trip id to keep it in scope for tooling; no further assertion.
    assert.ok(trip.id > 0);
  });
});

describe('US-007 LOCKED-immutability prerequisite', () => {
  test('createTripExpense rejects a LOCKED trip (409) — fee cannot be added after lock', async () => {
    const { trip, supplierId } = await createLockedTripWithFees({
      revenue: 2_000_000,
      departureDate: '2026-06-18',
      fees: [],
    });

    await assert.rejects(
      () => createTripExpense(db, {
        tripId: trip.id,
        forwarderId: null,
        expenseType: 'CHI_HO',
        buyAmount: '10000',
        sellAmount: '15000',
        settlementMethod: 'COMPANY_DIRECT',
        supplierId: supplierId ?? null,
        containerNumber: null,
        note: 'should fail',
      }),
      (err: unknown) => {
        assert.ok(err instanceof ApiError, 'ApiError thrown');
        assert.equal((err as ApiError).statusCode, 409);
        return true;
      },
    );
  });

  test('updateTripExpense rejects sellAmount change on a LOCKED trip (409)', async () => {
    const { trip, expenseRows } = await createLockedTripWithFees({
      revenue: 2_000_000,
      departureDate: '2026-06-18',
      fees: [
        { buyAmount: 50_000, sellAmount: 70_000, settlementMethod: 'COMPANY_DIRECT' },
      ],
    });

    await assert.rejects(
      () => updateTripExpense(db, expenseRows[0].id, { sellAmount: '999999' }),
      (err: unknown) => {
        assert.ok(err instanceof ApiError, 'ApiError thrown');
        assert.equal((err as ApiError).statusCode, 409);
        return true;
      },
    );
    // Reference trip to satisfy lint; the invariant under test is the 409 above.
    assert.ok(trip.id > 0);
  });
});

describe('US-007 aging: SERVICE_FEE AR surfaces in customer aging', () => {
  test('customer aging search matches Vietnamese names without requiring tones', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const accentedName = `Công ty Hải Đăng ${suffix}`;
    const { customer } = await createLockedTripWithFees({
      revenue: 44_000,
      departureDate: '2026-06-23',
      fees: [],
    });

    await db.update(s.customers)
      .set({ name: accentedName })
      .where(eq(s.customers.id, customer.id));

    // These integration tests invoke services directly, bypassing the route's
    // normal post-commit report-cache invalidation.
    await invalidateReportCaches();
    const list = await getCustomerAgingList({ search: `Hai Dang ${suffix}` });
    const found = list.customers.find(c => c.customerId === customer.id);

    assert.ok(found, 'unaccented search finds the accented Vietnamese customer name');
    assert.equal(found!.customerName, accentedName);
    assert.equal(found!.totalOutstanding, 44_000);
  });

  test('customer with only a SERVICE_FEE debit appears in aging list with balance=fee and days≈0', async () => {
    // Seed a customer whose ONLY AR is a chi hộ fee (no freight revenue).
    const { customer, customerName, expenseRows } = await createLockedTripWithFees({
      revenue: 0, // zero-revenue trip — confirmZeroRevenue lets it lock
      departureDate: '2026-06-22',
      fees: [
        { buyAmount: 20_000, sellAmount: 33_000, settlementMethod: 'COMPANY_DIRECT' },
      ],
    });

    // The customer's running balance must reflect the fee debit.
    const ar = await customerARFromLedger(customer.id);
    assert.equal(ar, 33_000, 'customer AR is exactly the chi hộ sell amount');

    // The full aging list (no txnType filter) must surface this customer with
    // the fee as its outstanding balance. Search by the unique name to find it
    // regardless of other pre-existing debtors in the dev DB.
    await invalidateReportCaches();
    const list = await getCustomerAgingList({ search: customerName });
    const found = list.customers.find(c => c.customerId === customer.id);
    assert.ok(found, 'seeded customer appears in aging list');
    assert.equal(found!.totalOutstanding, 33_000,
      `aging outstanding is the chi hộ AR; got ${found!.totalOutstanding}`);
    // SERVICE_FEE posts at NOW(), so the oldest-debit timestamp is moments ago.
    assert.ok(found!.maxOverdueDays <= 1,
      `freshly-posted SERVICE_FEE → days ≈ 0 (≤1); got ${found!.maxOverdueDays}`);

    // getTopOverdueCustomer returns the single highest-balance CUSTOMER across
    // the whole ledger (no txnType filter) — so SERVICE_FEE-only AR is eligible.
    // Assert it does not throw and returns a valid shape (the seeded customer
    // may not be the global top if the dev DB has larger debtors, but the call
    // must succeed and reflect chi hộ AR among the population).
    const top = await getTopOverdueCustomer();
    assert.ok(top, 'getTopOverdueCustomer returns a result');
    assert.ok(top!.balance > 0, 'top-overdue balance is positive');
    assert.ok(top!.days >= 0, 'top-overdue days is non-negative');

    // Reference expenseRows for provenance.
    assert.ok(expenseRows.length > 0);
  });
});

// ─── US-005b: billable status = COMPLETED + LOCKED (the /debt/2 fix) ────────
// Revenue posts to AR at COMPLETED (postTripLock on IN_TRANSIT→COMPLETED);
// LOCKED is an optional figures-freeze superset. The debt notice must bill BOTH.
// (P&L / profit-distribution remain LOCKED-only by spec — a distinct concept.)

interface BillableSeedCtx {
  customerId: number;
  routeId: number;
  cargoTypeId: number;
  supplierId?: number;
  suffix: string;
}

async function mkBillableSeedCtx(opts: { feesHaveSupplier: boolean }): Promise<BillableSeedCtx> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const [customer] = await db.insert(s.customers)
    .values({ name: `Recon customer ${suffix}` }).returning();
  const [route] = await db.insert(s.routes)
    .values({ name: `Recon route ${suffix}` }).returning();
  const [cargoType] = await db.insert(s.cargoTypes)
    .values({ name: `Recon cargo ${suffix}` }).returning();
  createdCustomerIds.push(customer.id);
  createdRouteIds.push(route.id);
  createdCargoTypeIds.push(cargoType.id);
  let supplierId: number | undefined;
  if (opts.feesHaveSupplier) {
    const [supplier] = await db.insert(s.suppliers)
      .values({ name: `Recon supplier ${suffix}` }).returning();
    supplierId = supplier.id;
    createdSupplierIds.push(supplierId);
  }
  return { customerId: customer.id, routeId: route.id, cargoTypeId: cargoType.id, supplierId, suffix };
}

interface BillableTripSpec {
  revenue: number;
  departureDate: string;
  lock?: boolean;
  fees: FeeSpec[];
  carrierType?: 'OWN' | 'EXTERNAL';
  externalCarrierId?: number;
  externalFreightCost?: number;
}

/** Create a billable trip for an existing seed context (enables multi-trip-same-customer
 *  tests). Transitions IN_TRANSIT→COMPLETED (posts ledger) and optionally →LOCKED. */
async function createBillableTrip(ctx: BillableSeedCtx, spec: BillableTripSpec) {
  const [trip] = await db.insert(s.trips).values({
    tripCode: `RC-${ctx.suffix}-${Math.random().toString(36).slice(2, 8)}`.slice(0, 50),
    customerId: ctx.customerId,
    routeId: ctx.routeId,
    cargoTypeId: ctx.cargoTypeId,
    status: TripStatus.IN_TRANSIT,
    departureDate: spec.departureDate,
    revenue: String(spec.revenue),
    carrierType: spec.carrierType ?? 'OWN',
    ...(spec.externalCarrierId != null ? { externalCarrierId: spec.externalCarrierId } : {}),
    ...(spec.externalFreightCost != null ? { externalFreightCost: String(spec.externalFreightCost) } : {}),
  }).returning();
  createdTripIds.push(trip.id);
  for (const fee of spec.fees) {
    const [row] = await db.insert(s.tripExpenses).values({
      tripId: trip.id,
      expenseType: fee.expenseType ?? 'CHI_HO',
      buyAmount: String(fee.buyAmount),
      sellAmount: String(fee.sellAmount),
      settlementMethod: fee.settlementMethod,
      supplierId: fee.settlementMethod === 'COMPANY_DIRECT' ? (fee.supplierId ?? ctx.supplierId ?? null) : null,
      approvalStatus: fee.approvalStatus ?? 'APPROVED',
    }).returning();
    createdExpenseIds.push(row.id);
  }
  await transitionTripStatus(trip.id, TripStatus.COMPLETED, 1, Role.MANAGER);
  if (spec.lock !== false) {
    await transitionTripStatus(trip.id, TripStatus.LOCKED, 1, Role.MANAGER, true, true);
  }
  return { trip };
}

describe('US-005b billable status: COMPLETED trips appear on the debt notice', () => {
  test('a COMPLETED-only trip (never LOCKED) surfaces freight + phí chi hộ', async () => {
    const { customer } = await createLockedTripWithFees({
      revenue: 4_500_000,
      departureDate: '2026-06-11',
      lock: false,
      fees: [{ buyAmount: 60_000, sellAmount: 80_000, settlementMethod: 'COMPANY_DIRECT' }],
    });
    const draft = await generateDraft({
      type: 'DEBIT_NOTE', entityType: 'CUSTOMER', entityId: customer.id,
      rangeFrom: '2026-06-01', rangeTo: '2026-06-30',
    });
    assert.equal(draft.lines.length, 2, 'COMPLETED trip yields freight + phí chi hộ');
    assert.equal(draft.totalInclVat, 4_500_000 + 80_000);
    assert.ok(draft.lines.some(l => l.lineType === 'FREIGHT'), 'freight line present');
    assert.ok(draft.lines.some(l => l.lineType === 'SERVICE_FEE'), 'phí chi hộ line present');
  });

  test('a CANCELED trip is excluded (no lines, total 0)', async () => {
    const { trip, customer } = await createLockedTripWithFees({
      revenue: 5_000_000, departureDate: '2026-06-12', lock: false,
      fees: [{ buyAmount: 50_000, sellAmount: 70_000, settlementMethod: 'COMPANY_DIRECT' }],
    });
    // COMPLETED → CANCELED reverses the ledger and zeroes revenue; the status
    // predicate (IN COMPLETED/LOCKED) then excludes it from the notice.
    await transitionTripStatus(trip.id, TripStatus.CANCELED, 1, Role.MANAGER);
    const draft = await generateDraft({
      type: 'DEBIT_NOTE', entityType: 'CUSTOMER', entityId: customer.id,
      rangeFrom: '2026-06-01', rangeTo: '2026-06-30',
    });
    assert.equal(draft.lines.length, 0, 'CANCELED trip excluded');
    assert.equal(draft.totalInclVat, 0);
  });

  test('mixed-status: one COMPLETED + one LOCKED trip, same customer → both appear', async () => {
    const ctx = await mkBillableSeedCtx({ feesHaveSupplier: false });
    await createBillableTrip(ctx, { revenue: 3_000_000, departureDate: '2026-06-09', lock: false, fees: [] });
    await createBillableTrip(ctx, { revenue: 2_000_000, departureDate: '2026-06-10', lock: true, fees: [] });
    const draft = await generateDraft({
      type: 'DEBIT_NOTE', entityType: 'CUSTOMER', entityId: ctx.customerId,
      rangeFrom: '2026-06-01', rangeTo: '2026-06-30',
    });
    const freightLines = draft.lines.filter(l => l.lineType === 'FREIGHT');
    assert.equal(freightLines.length, 2, 'both COMPLETED and LOCKED trips appear');
    assert.equal(draft.totalInclVat, 5_000_000);
  });
});

describe('US-005b carrier payment statement bills COMPLETED external-carrier trips', () => {
  test('PAYMENT_STATEMENT for a carrier surfaces freight for their COMPLETED trip', async () => {
    const ctx = await mkBillableSeedCtx({ feesHaveSupplier: false });
    const [carrier] = await db.insert(s.customers)
      .values({ name: `Recon carrier ${ctx.suffix}`, isCarrier: true }).returning();
    createdCustomerIds.push(carrier.id);
    await createBillableTrip(ctx, {
      revenue: 6_000_000, departureDate: '2026-06-13', lock: false, fees: [],
      carrierType: 'EXTERNAL', externalCarrierId: carrier.id, externalFreightCost: 3_500_000,
    });
    const draft = await generateDraft({
      type: 'PAYMENT_STATEMENT', entityType: 'CUSTOMER', entityId: carrier.id,
      rangeFrom: '2026-06-01', rangeTo: '2026-06-30',
    });
    assert.equal(draft.lines.length, 1, 'carrier payment surfaces the external-freight line');
    assert.equal(draft.totalInclVat, 3_500_000);
    assert.equal(draft.lines[0].lineType, 'FREIGHT');
  });
});

describe('US-005b edited-COMPLETED reconciliation: ledger stays in sync after a figure edit', () => {
  test('after editing revenue on a COMPLETED trip, draft.totalInclVat == customer running balance', async () => {
    const from = '2026-06-01', to = '2026-06-30';
    const { trip, customer, expenseRows } = await createLockedTripWithFees({
      revenue: 5_000_000, departureDate: '2026-06-14', lock: false,
      fees: [{ buyAmount: 40_000, sellAmount: 60_000, settlementMethod: 'COMPANY_DIRECT' }],
    });
    const sellFees = expenseRows.reduce((a, f) => a + Number(f.sellAmount ?? 0), 0);

    // Pre-edit: debt notice == ledger running balance.
    const draft0 = await generateDraft({
      type: 'DEBIT_NOTE', entityType: 'CUSTOMER', entityId: customer.id, rangeFrom: from, rangeTo: to,
    });
    const bal0 = await LedgerService.getBalance('CUSTOMER', customer.id);
    assert.ok(Math.abs(draft0.totalInclVat - bal0) <= 1, `pre-edit: draft ${draft0.totalInclVat} vs balance ${bal0}`);

    // Edit revenue via the figure-update path — the unlock+relock swap at
    // trip-mutations.service.ts:672-712 re-posts the ledger at the new values.
    await updateTripFigures(trip.id, {
      legs: [{ sequence: 1, origin: 'A', destination: 'B', km: 100, loadingType: LoadingType.HANG }],
      fuelMode: FuelMode.FLAT_RATE,
      fuelLitersOverride: 0,
      revenue: 7_500_000,
      routeId: trip.routeId,
      userId: 1,
    });

    // Post-edit: read the trip's ACTUAL stored revenue (resolveRevenue may transform
    // the override) and assert draft == ledger running balance == storedRevenue + fees.
    const [edited] = await db.select().from(s.trips).where(eq(s.trips.id, trip.id)).limit(1);
    const expected = Number(edited.revenue) + sellFees;
    const draft1 = await generateDraft({
      type: 'DEBIT_NOTE', entityType: 'CUSTOMER', entityId: customer.id, rangeFrom: from, rangeTo: to,
    });
    const bal1 = await LedgerService.getBalance('CUSTOMER', customer.id);
    assert.equal(draft1.totalInclVat, expected, 'draft reflects edited revenue + phí chi hộ');
    assert.ok(Math.abs(draft1.totalInclVat - bal1) <= 1, `post-edit draft ${draft1.totalInclVat} == ledger balance ${bal1}`);
  });
});
