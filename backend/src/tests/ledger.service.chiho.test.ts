import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray } from 'drizzle-orm';
import { TripStatus, Role, TxnType } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import { LedgerService } from '../services/ledger.service';
import { createTripExpense } from '../services/forwarder.service';
import {
  approveGovernanceAction,
  checkGovernanceAction,
  requestCompletedTripCancellation,
  requestTripFinancialClose,
} from '../services/adjustment-governance.service';
import { disconnectRedis } from '../lib/redis';

/**
 * US-002 / US-003 — chi hộ (service-fee) sell-side AR posting.
 *
 * Verifies that the SELL side of ancillary fees hits the CUSTOMER AR ledger
 * at trip lock, and is reversed at trip unlock — so debt notices and customer
 * statements agree on the phí chi hộ amounts.
 *
 * Pattern mirrors trip-ledger-completion.test.ts: real Postgres, drive state
 * transitions through the status machine, clean up created rows in `after`.
 */

const createdTripIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdSupplierIds: number[] = [];
const createdForwarderIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdExpenseIds: number[] = [];
const createdGovernanceUserIds: number[] = [];

after(async () => {
  let cleanupStep = 'governance actions';
  try {
  if (createdTripIds.length > 0) {
    await db.delete(s.governanceActions).where(inArray(s.governanceActions.subjectId, createdTripIds));
  }
  cleanupStep = 'ledger';
  // Ledger rows reference both trip ids (TRIP_REVENUE) and expense ids
  // (SERVICE_FEE / VENDOR_EXPENSE / FORWARDER_ADVANCE) via txnId.
  const allTxnIds = [...createdTripIds, ...createdExpenseIds];
  if (allTxnIds.length > 0) {
    await db.delete(s.ledger).where(inArray(s.ledger.txnId, allTxnIds));
  }
  if (createdExpenseIds.length > 0) {
    cleanupStep = 'trip expenses';
    await db.delete(s.tripExpenses).where(inArray(s.tripExpenses.id, createdExpenseIds));
  }
  if (createdTripIds.length > 0) {
    cleanupStep = 'trips';
    await db.delete(s.profitabilitySnapshots).where(inArray(s.profitabilitySnapshots.tripId, createdTripIds));
    await db.delete(s.tripFinancialPostings).where(inArray(s.tripFinancialPostings.tripId, createdTripIds));
    await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
  }
  const allUserIds = [...createdForwarderIds, ...createdGovernanceUserIds];
  if (allUserIds.length > 0) {
    cleanupStep = 'notifications';
    await db.delete(s.notifications).where(inArray(s.notifications.userId, allUserIds));
    cleanupStep = 'users';
    await db.delete(s.users).where(inArray(s.users.id, allUserIds));
  }
  if (createdSupplierIds.length > 0) {
    cleanupStep = 'suppliers';
    await db.delete(s.suppliers).where(inArray(s.suppliers.id, createdSupplierIds));
  }
  if (createdCustomerIds.length > 0) {
    cleanupStep = 'customers';
    await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
  }
  if (createdRouteIds.length > 0) {
    cleanupStep = 'routes';
    await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
  }
  if (createdCargoTypeIds.length > 0) {
    cleanupStep = 'cargo types';
    await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, createdCargoTypeIds));
  }
  } catch (error) {
    console.error(`[chiho cleanup] failed at ${cleanupStep}`, error);
    throw error;
  }
  await disconnectRedis();
  await client.end();
});

async function approveCompletedCancellation(tripId: number, expectedVersion: number) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const actors = await db.insert(s.users).values([
    { username: `chiho-ledger-maker-${suffix}`, passwordHash: 'x', role: Role.MANAGER },
    { username: `chiho-ledger-checker-${suffix}`, passwordHash: 'x', role: Role.ACCOUNTANT },
    { username: `chiho-ledger-approver-${suffix}`, passwordHash: 'x', role: Role.ADMIN },
  ]).returning({ id: s.users.id });
  createdGovernanceUserIds.push(...actors.map((actor) => actor.id));
  const action = await requestCompletedTripCancellation({
    tripId,
    reason: 'Hủy chuyến đã hoàn thành và hoàn nhập phí chi hộ',
    makerId: actors[0]!.id,
    makerRole: Role.MANAGER,
    expectedTripVersion: expectedVersion,
  });
  const checked = await checkGovernanceAction({
    actionId: action.id,
    checkerId: actors[1]!.id,
    checkerRole: Role.ACCOUNTANT,
    expectedVersion: action.version,
  });
  return approveGovernanceAction({
    actionId: action.id,
    approverId: actors[2]!.id,
    approverRole: Role.ADMIN,
    expectedVersion: checked.version,
  });
}

async function completeTripGoverned(tripId: number, expectedVersion: number) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const actors = await db.insert(s.users).values([
    { username: `chiho-close-maker-${suffix}`, passwordHash: 'x', role: Role.MANAGER },
    { username: `chiho-close-checker-${suffix}`, passwordHash: 'x', role: Role.ACCOUNTANT },
    { username: `chiho-close-approver-${suffix}`, passwordHash: 'x', role: Role.ADMIN },
  ]).returning({ id: s.users.id });
  createdGovernanceUserIds.push(...actors.map((actor) => actor.id));
  const action = await requestTripFinancialClose({
    tripId,
    reason: 'Hoàn thành chuyến và ghi nhận phí chi hộ',
    makerId: actors[0]!.id,
    makerRole: Role.MANAGER,
    expectedTripVersion: expectedVersion,
  });
  const checked = await checkGovernanceAction({
    actionId: action.id,
    checkerId: actors[1]!.id,
    checkerRole: Role.ACCOUNTANT,
    expectedVersion: action.version,
  });
  await approveGovernanceAction({
    actionId: action.id,
    approverId: actors[2]!.id,
    approverRole: Role.ADMIN,
    expectedVersion: checked.version,
  });
  const [completed] = await db.select().from(s.trips)
    .where(eq(s.trips.id, tripId))
    .limit(1);
  assert.ok(completed);
  return completed;
}

interface FeeSpec {
  buyAmount: number;
  sellAmount: number;
  settlementMethod: 'COMPANY_DIRECT' | 'FORWARDER_ADVANCE';
  supplierId?: number;
  forwarderId?: number;
  approvalStatus?: string;
  expenseType?: string;
}

async function createInTransitTripWithFees(
  values: { revenue: number },
  fees: FeeSpec[],
) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const [customer] = await db.insert(s.customers)
    .values({ name: `ChiHo customer ${suffix}` }).returning();
  const [route] = await db.insert(s.routes)
    .values({ name: `ChiHo route ${suffix}` }).returning();
  const [cargoType] = await db.insert(s.cargoTypes)
    .values({ name: `ChiHo cargo ${suffix}` }).returning();
  createdCustomerIds.push(customer.id);
  createdRouteIds.push(route.id);
  createdCargoTypeIds.push(cargoType.id);

  // Create a supplier + forwarder (user) if any fee needs them.
  let supplierId: number | undefined;
  let forwarderId: number | undefined;
  if (fees.some(f => f.settlementMethod === 'COMPANY_DIRECT')) {
    const [supplier] = await db.insert(s.suppliers)
      .values({ name: `ChiHo supplier ${suffix}` }).returning();
    supplierId = supplier.id;
    createdSupplierIds.push(supplierId);
  }
  if (fees.some(f => f.settlementMethod === 'FORWARDER_ADVANCE')) {
    // Users table is the home of forwarders; role DRIVER is a safe lower-priv
    // slot. We only need a row with an id to satisfy the FK.
    const [fwd] = await db.insert(s.users)
      .values({
        username: `chiho-fwd-${suffix}`.slice(0, 50),
        passwordHash: 'x',
        fullName: `ChiHo forwarder ${suffix}`,
        role: 'DRIVER',
        status: 'ACTIVE',
      }).returning();
    forwarderId = fwd.id;
    createdForwarderIds.push(forwarderId);
  }

  const [trip] = await db.insert(s.trips).values({
    tripCode: `CH-${suffix}`.slice(0, 50),
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    status: TripStatus.IN_TRANSIT,
    departureDate: '2026-06-20',
    revenue: String(values.revenue),
    carrierType: 'OWN',
  }).returning();
  createdTripIds.push(trip.id);

  const expenseRows: Array<typeof s.tripExpenses.$inferSelect> = [];
  for (const fee of fees) {
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

  return { trip, customer, supplierId, forwarderId, expenseRows };
}

async function ledgerRowsForTripCustomer(tripId: number, customerId: number) {
  return db.select().from(s.ledger)
    .where(and(
      eq(s.ledger.entityType, 'CUSTOMER'),
      eq(s.ledger.entityId, customerId),
    ))
    .orderBy(s.ledger.id);
}

/**
 * Insert an ancillary fee row directly, bypassing createInTransitTripWithFees
 * (which forces a real counterparty). Used to construct null-counterparty
 * APPROVED fees for the validation/skip tests. Registers the row for cleanup.
 */
async function insertRawFee(
  tripId: number,
  overrides: {
    buyAmount: number;
    sellAmount: number;
    settlementMethod: 'COMPANY_DIRECT' | 'FORWARDER_ADVANCE';
    forwarderId?: number | null;
    supplierId?: number | null;
    approvalStatus?: string;
  },
) {
  const [row] = await db.insert(s.tripExpenses).values({
    tripId,
    forwarderId: overrides.forwarderId ?? null,
    expenseType: 'CHI_HO',
    buyAmount: String(overrides.buyAmount),
    sellAmount: String(overrides.sellAmount),
    settlementMethod: overrides.settlementMethod,
    supplierId: overrides.supplierId ?? null,
    approvalStatus: overrides.approvalStatus ?? 'APPROVED',
  }).returning();
  createdExpenseIds.push(row.id);
  return row;
}

describe('chi hộ (service-fee) sell-side AR ledger posting', () => {
  test('posts a SERVICE_FEE debit to CUSTOMER for each APPROVED fee sell side at lock', async () => {
    const revenue = 5_000_000;
    const { trip, customer, expenseRows } = await createInTransitTripWithFees(
      { revenue },
      [
        // FORWARDER_ADVANCE fee: buy 100k, sell 120k
        { buyAmount: 100_000, sellAmount: 120_000, settlementMethod: 'FORWARDER_ADVANCE' },
        // COMPANY_DIRECT fee: buy 80k, sell 95k
        { buyAmount: 80_000, sellAmount: 95_000, settlementMethod: 'COMPANY_DIRECT' },
      ],
    );

    await completeTripGoverned(trip.id, trip.version);

    const customerRows = await ledgerRowsForTripCustomer(trip.id, customer.id);

    // 1 TRIP_REVENUE debit
    const revenueRows = customerRows.filter(r => r.txnType === TxnType.TRIP_REVENUE);
    assert.equal(revenueRows.length, 1, 'exactly one TRIP_REVENUE row');
    assert.equal(revenueRows[0].debit, String(revenue));
    assert.equal(revenueRows[0].credit, '0');

    // 2 SERVICE_FEE debits (one per fee), each with the sell amount
    const sellFeeRows = customerRows.filter(r => r.txnType === TxnType.SERVICE_FEE);
    assert.equal(sellFeeRows.length, 2, 'one SERVICE_FEE row per APPROVED fee');
    assert.ok(sellFeeRows.some(r =>
      r.txnId === expenseRows[0].id && r.debit === '120000' && r.credit === '0'
    ), 'forwarder-advance fee sell side (120000) posted');
    assert.ok(sellFeeRows.some(r =>
      r.txnId === expenseRows[1].id && r.debit === '95000' && r.credit === '0'
    ), 'company-direct fee sell side (95000) posted');

    // Σ customer debits for the trip == revenue + 120000 + 95000
    const totalDebit = customerRows
      .filter(r => r.txnType === TxnType.TRIP_REVENUE || r.txnType === TxnType.SERVICE_FEE)
      .reduce((acc, r) => acc + Number(r.debit), 0);
    assert.equal(totalDebit, revenue + 120_000 + 95_000);
  });

  test('a fee with sellAmount=0 produces no SERVICE_FEE customer posting', async () => {
    const { trip, customer } = await createInTransitTripWithFees(
      { revenue: 2_000_000 },
      [
        // Sell side is zero — no AR posting should occur.
        { buyAmount: 70_000, sellAmount: 0, settlementMethod: 'COMPANY_DIRECT' },
      ],
    );

    await completeTripGoverned(trip.id, trip.version);

    const customerRows = await ledgerRowsForTripCustomer(trip.id, customer.id);
    const sellFeeRows = customerRows.filter(r => r.txnType === TxnType.SERVICE_FEE);
    assert.equal(sellFeeRows.length, 0, 'zero-sell fee must not post SERVICE_FEE AR');
  });

  test('a PENDING fee produces no buy-side AND no sell-side posting', async () => {
    const { trip, customer } = await createInTransitTripWithFees(
      { revenue: 1_500_000 },
      [
        {
          buyAmount: 60_000,
          sellAmount: 90_000,
          settlementMethod: 'COMPANY_DIRECT',
          approvalStatus: 'PENDING',
        },
      ],
    );

    await completeTripGoverned(trip.id, trip.version);

    const allRowsForTrip = await db.select().from(s.ledger)
      .where(eq(s.ledger.txnId, trip.id))
      .orderBy(s.ledger.id);

    // No VENDOR_EXPENSE and no SERVICE_FEE for this fee (only TRIP_REVENUE for the trip).
    assert.equal(allRowsForTrip.filter(r => r.txnType === TxnType.VENDOR_EXPENSE).length, 0);
    assert.equal(allRowsForTrip.filter(r => r.txnType === TxnType.SERVICE_FEE).length, 0);

    const customerRows = await ledgerRowsForTripCustomer(trip.id, customer.id);
    assert.equal(customerRows.filter(r => r.txnType === TxnType.SERVICE_FEE).length, 0);
  });

  test('canceling a completed trip reverses every sell-side fee so net customer balance is zero', async () => {
    const revenue = 3_000_000;
    const { trip, customer } = await createInTransitTripWithFees(
      { revenue },
      [
        { buyAmount: 100_000, sellAmount: 120_000, settlementMethod: 'FORWARDER_ADVANCE' },
        { buyAmount: 80_000, sellAmount: 95_000, settlementMethod: 'COMPANY_DIRECT' },
      ],
    );

    // COMPLETED posts TRIP_REVENUE + 2 SERVICE_FEE debits to the customer.
    const completed = await completeTripGoverned(trip.id, trip.version);
    // COMPLETED → CANCELED is the transition that invokes postTripUnlock,
    // which posts UNLOCK_REVERSAL rows for revenue + every sell fee.
    await approveCompletedCancellation(trip.id, completed.version);

    const customerRows = await ledgerRowsForTripCustomer(trip.id, customer.id);

    // Expect: TRIP_REVENUE debit, 2 SERVICE_FEE debits, then UNLOCK_REVERSAL
    // credits for revenue + 2 fees. Net customer balance for this entity == 0.
    const reversalRows = customerRows.filter(r => r.txnType === TxnType.UNLOCK_REVERSAL);
    // 1 revenue reversal + 2 sell-fee reversals = 3
    assert.equal(reversalRows.length, 3, 'reversal rows for revenue + 2 sell fees');

    const totalDebit = customerRows.reduce((acc, r) => acc + Number(r.debit), 0);
    const totalCredit = customerRows.reduce((acc, r) => acc + Number(r.credit), 0);
    assert.equal(totalDebit - totalCredit, 0, 'net customer balance contribution is zero');

    // Latest running balance column should be '0'.
    const latest = customerRows.at(-1);
    assert.ok(latest, 'at least one customer ledger row exists');
    assert.equal(latest!.balance, '0', 'latest running balance is zero');

    // Trip and fee IDs come from different tables and may overlap on a fresh
    // database, so prove the reversal set by amounts rather than a polymorphic
    // txnId alone.
    const expectedReversalCredits = customerRows
      .filter(r => r.txnType === TxnType.TRIP_REVENUE || r.txnType === TxnType.SERVICE_FEE)
      .map(r => Number(r.debit))
      .sort((a, b) => a - b);
    const actualReversalCredits = reversalRows
      .map(r => Number(r.credit))
      .sort((a, b) => a - b);
    assert.deepEqual(actualReversalCredits, expectedReversalCredits, 'revenue and every sell fee are reversed exactly');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Null-counterparty fee guards (validateAncillaryFees / strict vs skip)
  // ─────────────────────────────────────────────────────────────────────────

  test('strict completion posts an APPROVED fee without a payable counterparty to customer AR', async () => {
    const { trip, customer } = await createInTransitTripWithFees({ revenue: 5_000_000 }, []);
    const fee = await insertRawFee(trip.id, {
      buyAmount: 100_000,
      sellAmount: 120_000,
      settlementMethod: 'FORWARDER_ADVANCE',
      forwarderId: null,
      supplierId: null,
      approvalStatus: 'APPROVED',
    });

    await completeTripGoverned(trip.id, trip.version);

    const feeLedgerRows = await db.select().from(s.ledger)
      .where(and(
        eq(s.ledger.txnId, fee.id),
        eq(s.ledger.txnType, TxnType.SERVICE_FEE),
      ));
    assert.equal(feeLedgerRows.length, 1, 'SERVICE_FEE row posted for receivables-only fee');
    assert.equal(feeLedgerRows[0].entityType, 'CUSTOMER');
    assert.equal(feeLedgerRows[0].entityId, customer.id);
    assert.equal(feeLedgerRows[0].txnType, TxnType.SERVICE_FEE);
    assert.equal(feeLedgerRows[0].debit, '120000');
    assert.equal(feeLedgerRows[0].credit, '0');
  });

  test('non-strict postTripLock also posts a null-counterparty fee to customer AR', async () => {
    // Build a minimal IN_TRANSIT trip (no driver — postTripLock does not require
    // one) so the only entries are TRIP_REVENUE + the (skipped) fee.
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const [customer] = await db.insert(s.customers)
      .values({ name: `ChiHo skip-cust ${suffix}` }).returning();
    const [route] = await db.insert(s.routes)
      .values({ name: `ChiHo skip-route ${suffix}` }).returning();
    const [cargoType] = await db.insert(s.cargoTypes)
      .values({ name: `ChiHo skip-cargo ${suffix}` }).returning();
    createdCustomerIds.push(customer.id);
    createdRouteIds.push(route.id);
    createdCargoTypeIds.push(cargoType.id);

    const [trip] = await db.insert(s.trips).values({
      tripCode: `CH-SKIP-${suffix}`.slice(0, 50),
      customerId: customer.id,
      routeId: route.id,
      cargoTypeId: cargoType.id,
      status: TripStatus.IN_TRANSIT,
      departureDate: '2026-06-20',
      revenue: '5000000',
      carrierType: 'OWN',
    }).returning();
    createdTripIds.push(trip.id);

    const fee = await insertRawFee(trip.id, {
      buyAmount: 100_000,
      sellAmount: 120_000,
      settlementMethod: 'FORWARDER_ADVANCE',
      forwarderId: null,
      supplierId: null,
      approvalStatus: 'APPROVED',
    });

    // Commit the transaction so we can query the ledger afterward; the after()
    // hook deletes ledger rows by txnId (tripId + feeId) so cleanup is covered.
    const skipped = await db.transaction(async (tx) => {
      return LedgerService.postTripLock(
        tx,
        {
          id: trip.id,
          tripCode: trip.tripCode,
          customerId: trip.customerId,
          driverId: null,
          revenue: '5000000',
          driverSalary: '0',
          carrierType: 'OWN',
          ancillaryFees: [
            {
              id: fee.id,
              buyAmount: '100000',
              sellAmount: '120000',
              settlementMethod: 'FORWARDER_ADVANCE',
              supplierId: null,
              forwarderId: null,
              approvalStatus: 'APPROVED',
            },
          ],
        },
        { strict: false },
      );
    });

    assert.deepEqual(skipped, [], 'receivables-only fees are not skipped for missing payable counterparties');

    // The fee still posts to CUSTOMER AR; no payable-side row is needed.
    const feeRows = await db.select().from(s.ledger)
      .where(and(
        eq(s.ledger.txnId, fee.id),
        eq(s.ledger.txnType, TxnType.SERVICE_FEE),
      ));
    assert.equal(feeRows.length, 1, 'fee produced one SERVICE_FEE AR row');
    assert.equal(feeRows[0].txnType, TxnType.SERVICE_FEE);
    assert.equal(feeRows[0].entityType, 'CUSTOMER');
    assert.equal(feeRows[0].debit, '120000');
    assert.equal(feeRows[0].credit, '0');

    // The unrelated TRIP_REVENUE entry still posted.
    const revenueRows = await db.select().from(s.ledger)
      .where(and(
        eq(s.ledger.txnId, trip.id),
        eq(s.ledger.txnType, TxnType.TRIP_REVENUE),
      ));
    assert.equal(revenueRows.length, 1, 'TRIP_REVENUE still posted');
    assert.equal(revenueRows[0].debit, '5000000');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // D2: forwarder.service createTripExpense counterparty guard
  // ─────────────────────────────────────────────────────────────────────────

  test('createTripExpense accepts a FORWARDER_ADVANCE fee with no forwarder', async () => {
    const { trip } = await createInTransitTripWithFees({ revenue: 1_000_000 }, []);
    const inserted = await createTripExpense(db, {
      tripId: trip.id,
      forwarderId: null,
      expenseType: 'CHI_HO',
      buyAmount: '100000',
      sellAmount: '120000',
      invoiceNumber: 'CHI-HO-TEST',
      settlementMethod: 'FORWARDER_ADVANCE',
      supplierId: null,
      note: null,
    });
    assert.ok(inserted.id, 'fee inserted without payable counterparty');
    assert.equal(inserted.forwarderId, null);
    assert.equal(inserted.approvalStatus, 'APPROVED');
    createdExpenseIds.push(inserted.id);
  });

  test('createTripExpense accepts a COMPANY_DIRECT fee with no supplier', async () => {
    const { trip } = await createInTransitTripWithFees({ revenue: 1_000_000 }, []);
    const inserted = await createTripExpense(db, {
      tripId: trip.id,
      forwarderId: null,
      expenseType: 'CHI_HO',
      buyAmount: '100000',
      sellAmount: '120000',
      invoiceNumber: 'CHI-HO-TEST',
      settlementMethod: 'COMPANY_DIRECT',
      supplierId: null,
      note: null,
    });
    assert.ok(inserted.id, 'fee inserted without payable counterparty');
    assert.equal(inserted.supplierId, null);
    assert.equal(inserted.approvalStatus, 'APPROVED');
    createdExpenseIds.push(inserted.id);
  });

  test('createTripExpense accepts a balanced FORWARDER_ADVANCE fee with a forwarder', async () => {
    // createInTransitTripWithFees creates a forwarder user when asked for a
    // FORWARDER_ADVANCE fee; we reuse that forwarderId here.
    const { trip, forwarderId } = await createInTransitTripWithFees(
      { revenue: 1_000_000 },
      [{ buyAmount: 1, sellAmount: 1, settlementMethod: 'FORWARDER_ADVANCE' }],
    );
    assert.ok(forwarderId, 'helper created a forwarder');

    const inserted = await createTripExpense(db, {
      tripId: trip.id,
      forwarderId: forwarderId!,
      expenseType: 'CHI_HO',
      buyAmount: '100000',
      sellAmount: '120000',
      invoiceNumber: 'CHI-HO-TEST',
      settlementMethod: 'FORWARDER_ADVANCE',
      supplierId: null,
      note: null,
    });
    assert.ok(inserted.id, 'fee inserted');
    assert.equal(inserted.forwarderId, forwarderId);
    assert.equal(inserted.approvalStatus, 'PENDING'); // forwarder-created → pending approval
    createdExpenseIds.push(inserted.id);
  });

  test('createTripExpense accepts an office-approved FORWARDER_ADVANCE fee with a forwarder', async () => {
    const { trip, forwarderId } = await createInTransitTripWithFees(
      { revenue: 1_000_000 },
      [{ buyAmount: 1, sellAmount: 1, settlementMethod: 'FORWARDER_ADVANCE' }],
    );
    assert.ok(forwarderId, 'helper created a forwarder');

    const inserted = await createTripExpense(db, {
      tripId: trip.id,
      forwarderId: forwarderId!,
      expenseType: 'CHI_HO',
      buyAmount: '100000',
      sellAmount: '120000',
      invoiceNumber: 'CHI-HO-TEST',
      settlementMethod: 'FORWARDER_ADVANCE',
      supplierId: null,
      approvalStatus: 'APPROVED',
      note: null,
    });
    assert.ok(inserted.id, 'fee inserted');
    assert.equal(inserted.forwarderId, forwarderId);
    assert.equal(inserted.approvalStatus, 'APPROVED');
    createdExpenseIds.push(inserted.id);
  });
});
