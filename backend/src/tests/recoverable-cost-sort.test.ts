import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { getRecoverableCost, listRecoverableCosts, type RecoverableEligibilityState } from '../services/recoverable-cost.service';

// Column sorting for the recoverable-costs ledger: whitelisted keys, numeric
// money ordering, the replicated variance/eligibility/evidence expressions,
// and an unchanged default order when the sort params are absent.
const marker = `RC sort ${Date.now()}`;

const adminActor = { userId: 0, role: Role.ADMIN };

/** Rank mirroring eligibilityRankSortSql() — the frontend state order. */
const ELIGIBILITY_RANK: Record<RecoverableEligibilityState, number> = {
  READY_FOR_REVIEW: 0,
  ELIGIBLE: 1,
  BLOCKED: 2,
  ALREADY_CLAIMED: 3,
  ADJUSTMENT_REQUIRED: 4,
};

const createdExpenseIds: number[] = [];
const createdTripIds: number[] = [];
const createdShipmentIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdClaimIds: number[] = [];
const createdBillingDocIds: number[] = [];

async function seedBase() {
  const [route] = await db.insert(s.routes).values({ name: `${marker} route` }).returning();
  createdRouteIds.push(route.id);
  // Two customers so a name sort has two distinct values.
  for (const name of [`${marker} Zeta`, `${marker} Anpha`]) {
    const [customer] = await db.insert(s.customers).values({ name }).returning({ id: s.customers.id });
    createdCustomerIds.push(customer.id);
  }
  return { routeId: route.id };
}

async function seedShipment(customerId: number, shipmentCode: string | null) {
  const [shipment] = await db.insert(s.shipments).values({
    customerId,
    status: 'PENDING_DATE',
    shipmentCode,
  }).returning({ id: s.shipments.id });
  createdShipmentIds.push(shipment.id);
  return shipment.id;
}

async function seedTrip(customerId: number, routeId: number, shipmentId: number, tripCode: string | null) {
  const [trip] = await db.insert(s.trips).values({
    customerId,
    routeId,
    shipmentId,
    departureDate: '2026-07-15',
    tripCode,
  }).returning({ id: s.trips.id });
  createdTripIds.push(trip.id);
  return trip.id;
}

type ExpenseOverrides = Partial<typeof s.tripExpenses.$inferInsert> & {
  updatedAt?: Date;
};

async function seedExpense(tripId: number, overrides: ExpenseOverrides = {}): Promise<number> {
  const { updatedAt, ...rest } = overrides;
  const [row] = await db.insert(s.tripExpenses).values({
    tripId,
    expenseType: 'OTHER',
    buyAmount: '100000',
    sellAmount: '100000',
    updatedAt: updatedAt ?? new Date('2026-07-01T00:00:00Z'),
    ...rest,
  }).returning({ id: s.tripExpenses.id });
  createdExpenseIds.push(row.id);
  return row.id;
}

/** Builds the JS source-version string exactly like the service does — from a
 * freshly-selected row — so the claim's stored string is the genuine one. */
async function currentVersionOf(expenseId: number): Promise<string> {
  const [row] = await db.select({
    updatedAt: s.tripExpenses.updatedAt,
    approvalStatus: s.tripExpenses.approvalStatus,
    sellAmount: s.tripExpenses.sellAmount,
  }).from(s.tripExpenses).where(eq(s.tripExpenses.id, expenseId));
  assert.ok(row);
  return `expense:${row.updatedAt.toISOString()}:${row.approvalStatus}:${Number(row.sellAmount)}`;
}

async function seedClaim(expenseId: number, sourceVersion: string, debitNoteStatus: 'DRAFT' | 'SENT' | 'PENDING_CONFIRM' | 'CONFIRMED', rangeTo: string): Promise<void> {
  const [doc] = await db.insert(s.billingDocuments).values({
    type: 'DEBIT_NOTE',
    entityType: 'CUSTOMER',
    entityId: createdCustomerIds[0],
    rangeFrom: '2026-07-01',
    rangeTo,
    debitNoteStatus,
  }).returning({ id: s.billingDocuments.id });
  createdBillingDocIds.push(doc.id);
  const [claim] = await db.insert(s.billingDocumentRecoverableClaims).values({
    documentId: doc.id,
    expenseId,
    expenseVersion: 1,
    sourceVersion,
    evidenceSnapshot: {},
  }).returning({ id: s.billingDocumentRecoverableClaims.id });
  createdClaimIds.push(claim.id);
}

after(async () => {
  if (createdClaimIds.length) {
    await db.delete(s.billingDocumentRecoverableClaims).where(inArray(s.billingDocumentRecoverableClaims.id, createdClaimIds));
  }
  if (createdBillingDocIds.length) {
    await db.delete(s.billingDocuments).where(inArray(s.billingDocuments.id, createdBillingDocIds));
  }
  if (createdExpenseIds.length) {
    await db.delete(s.tripExpenses).where(inArray(s.tripExpenses.id, createdExpenseIds));
  }
  if (createdTripIds.length) {
    await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
  }
  if (createdShipmentIds.length) {
    await db.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
  }
  if (createdCustomerIds.length) {
    await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
  }
  if (createdRouteIds.length) {
    await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
  }
  await client.end();
});

describe('listRecoverableCosts column sorting', () => {
  test('sorts variance numerically, evidence by presence, eligibility by JS-agreeing rank; default order unchanged', async () => {
    const { routeId } = await seedBase();
    const [customerZeta, customerAnpha] = createdCustomerIds;

    const zetaShipment = await seedShipment(customerZeta, `${marker}-L01`);
    const anphaShipment = await seedShipment(customerAnpha, null);

    // ── Variance set (zeta): amounts chosen so numeric and lexicographic
    // order differ — numeric asc is 90k, 300k, 700k while a string sort of the
    // differences would give 300000 < 700000 < 90000.
    const tripVar = await seedTrip(customerZeta, routeId, zetaShipment, `${marker}-T1`);
    await seedExpense(tripVar, { buyAmount: '900000', sellAmount: '990000', updatedAt: new Date('2026-07-01T00:00:00Z') });   // variance +90k
    await seedExpense(tripVar, { buyAmount: '300000', sellAmount: '600000', updatedAt: new Date('2026-07-02T00:00:00Z') });   // variance +300k
    await seedExpense(tripVar, { buyAmount: '700000', sellAmount: '1400000', updatedAt: new Date('2026-07-03T00:00:00Z') });  // variance +700k

    // ── Eligibility/evidence set (anpha): one row per state branch, each with
    // a distinct evidence tier so the two sorts are independently observable.
    const tripEli = await seedTrip(customerAnpha, routeId, anphaShipment, null);
    await seedExpense(tripEli, {
      approvalStatus: 'PENDING',
      buyAmount: '100000', sellAmount: '150000',
      invoiceNumber: null, invoiceDate: null, noInvoiceEvidenceTypes: [],
      updatedAt: new Date('2026-07-04T00:00:00Z'),
    }); // READY_FOR_REVIEW · evidence 0
    await seedExpense(tripEli, {
      approvalStatus: 'APPROVED',
      buyAmount: '100000', sellAmount: '150000',
      recoverablePrincipalAmount: '100000', serviceFeeAmount: '50000',
      expenseDate: '2026-07-10',
      invoiceNumber: null, invoiceDate: null,
      noInvoiceEvidenceTypes: ['RECEIPT'],
      updatedAt: new Date('2026-07-05T00:00:00Z'),
    }); // ELIGIBLE · evidence 1
    await seedExpense(tripEli, {
      approvalStatus: 'REJECTED',
      buyAmount: '100000', sellAmount: '150000',
      invoiceNumber: 'INV-RC-1', invoiceDate: '2026-07-11',
      updatedAt: new Date('2026-07-06T00:00:00Z'),
    }); // BLOCKED · evidence 2

    // Claimed pair: fresh version → ALREADY_CLAIMED, stale → ADJUSTMENT_REQUIRED.
    const claimedFreshId = await seedExpense(tripEli, {
      approvalStatus: 'APPROVED',
      buyAmount: '100000', sellAmount: '150000',
      recoverablePrincipalAmount: '100000', serviceFeeAmount: '50000',
      expenseDate: '2026-07-12',
      invoiceNumber: 'INV-RC-2', invoiceDate: '2026-07-12',
      updatedAt: new Date('2026-07-07T00:00:00.123Z'),
    });
    const claimedStaleId = await seedExpense(tripEli, {
      approvalStatus: 'APPROVED',
      buyAmount: '100000', sellAmount: '150000',
      recoverablePrincipalAmount: '100000', serviceFeeAmount: '50000',
      expenseDate: '2026-07-13',
      invoiceNumber: 'INV-RC-3', invoiceDate: '2026-07-13',
      updatedAt: new Date('2026-07-08T00:00:00.999999Z'),
    });
    await seedClaim(claimedFreshId, await currentVersionOf(claimedFreshId), 'SENT', '2026-07-31');
    await seedClaim(claimedStaleId, 'expense:1999-01-01T00:00:00.000Z:APPROVED:1', 'SENT', '2026-07-30');

    const base = { page: 1, limit: 100, customerId: undefined };
    // The dev database carries real rows; every assertion scopes to the rows
    // this test seeded (both marker customers).
    const seeded = (items: Awaited<ReturnType<typeof listRecoverableCosts>>['items']) =>
      items.filter(item => item.customerName.startsWith(marker));

    // Absent sort params reproduce the default newest-first order exactly.
    const defaultOrder = await listRecoverableCosts(adminActor, { ...base });
    assert.deepEqual(seeded(defaultOrder.items).map(item => item.updatedAt), [
      '2026-07-08T00:00:00.999Z', // stale claim (μs timestamp — JS Date truncates)
      '2026-07-07T00:00:00.123Z', // fresh claim
      '2026-07-06T00:00:00.000Z', // blocked
      '2026-07-05T00:00:00.000Z', // eligible
      '2026-07-04T00:00:00.000Z', // ready
      '2026-07-03T00:00:00.000Z', // variance rows…
      '2026-07-02T00:00:00.000Z',
      '2026-07-01T00:00:00.000Z',
    ]);

    // Variance sorts numerically (zeta rows only carry distinct variances).
    const varianceAsc = await listRecoverableCosts(adminActor, { ...base, sortBy: 'variance', sortDir: 'asc' });
    const zetaVariances = varianceAsc.items.filter(item => item.customerName.includes('Zeta')).map(item => item.sellAmount - item.buyAmount);
    assert.deepEqual(zetaVariances, [90_000, 300_000, 700_000]);
    const varianceDesc = await listRecoverableCosts(adminActor, { ...base, sortBy: 'variance', sortDir: 'desc' });
    assert.deepEqual(
      varianceDesc.items.filter(item => item.customerName.includes('Zeta')).map(item => item.sellAmount - item.buyAmount),
      [700_000, 300_000, 90_000],
    );

    // Evidence: none (0) < substitute (1) < invoice (2); claimed rows carry
    // invoices too, so filter to the unclaimed review set.
    const evidenceAsc = await listRecoverableCosts(adminActor, { ...base, sortBy: 'evidence', sortDir: 'asc' });
    const reviewSet = evidenceAsc.items.filter(item => item.claim == null && item.customerName.includes('Anpha'));
    assert.deepEqual(reviewSet.map(item => item.invoiceNumber), [null, null, 'INV-RC-1']);

    // Eligibility asc ranks by the frontend state order; the SQL rank must
    // agree with the JS evaluateRecoverableEligibility on every row.
    const eligibilityAsc = await listRecoverableCosts(adminActor, { ...base, sortBy: 'eligibility', sortDir: 'asc' });
    const states = seeded(eligibilityAsc.items).map(item => item.eligibility.state);
    assert.deepEqual(states, [
      'ELIGIBLE',
      'BLOCKED',
      'BLOCKED',
      'BLOCKED', // variance rows are APPROVED but unclassified → BLOCKED (parity below)
      'BLOCKED',
      'BLOCKED',
      'ALREADY_CLAIMED',
      'ADJUSTMENT_REQUIRED',
    ]);
    // Full SQL↔JS parity: the SQL rank ordering equals sorting the JS-evaluated
    // states by the same rank map (ties keep the id-asc tiebreaker).
    const jsRanked = [...eligibilityAsc.items].sort((a, b) =>
      (ELIGIBILITY_RANK[a.eligibility.state] - ELIGIBILITY_RANK[b.eligibility.state])
      || (a.id - b.id));
    assert.deepEqual(
      eligibilityAsc.items.map(item => item.id),
      jsRanked.map(item => item.id),
    );

    // The version-string replication specifically: the fresh claim (string
    // built by the JS helper) ranks ALREADY_CLAIMED while the stale string
    // ranks ADJUSTMENT_REQUIRED — proving the SQL expression matches the JS
    // builder for both a millisecond timestamp and a μs-heavy one.
    assert.equal(eligibilityAsc.items.find(item => item.id === claimedFreshId)?.eligibility.state, 'ALREADY_CLAIMED');
    assert.equal(eligibilityAsc.items.find(item => item.id === claimedStaleId)?.eligibility.state, 'ADJUSTMENT_REQUIRED');

    // JS evaluation agrees on those two rows as well (the SQL didn't decide
    // alone — evaluateRecoverableEligibility returns the same states).
    assert.equal((await getRecoverableCost(adminActor, claimedFreshId)).eligibility.state, 'ALREADY_CLAIMED');
    assert.equal((await getRecoverableCost(adminActor, claimedStaleId)).eligibility.state, 'ADJUSTMENT_REQUIRED');

    // Customer name sorts with plain collation (Anpha < Zeta among seeded rows).
    const nameAsc = await listRecoverableCosts(adminActor, { ...base, sortBy: 'customerName', sortDir: 'asc' });
    const seededNames = seeded(nameAsc.items).map(item => item.customerName);
    assert.equal(seededNames[0].includes('Anpha'), true);
    assert.equal(seededNames[seededNames.length - 1].includes('Zeta'), true);

    // Shipment code: nulls sort last in BOTH directions — non-null codes fill
    // the head of the list and the null-coded anpha rows its tail.
    const codeAsc = seeded((await listRecoverableCosts(adminActor, { ...base, sortBy: 'shipmentCode', sortDir: 'asc' })).items);
    assert.notEqual(codeAsc[0].shipmentCode, null);
    assert.equal(codeAsc[codeAsc.length - 1].shipmentCode, null);
    const codeDesc = seeded((await listRecoverableCosts(adminActor, { ...base, sortBy: 'shipmentCode', sortDir: 'desc' })).items);
    assert.notEqual(codeDesc[0].shipmentCode, null);
    assert.equal(codeDesc[codeDesc.length - 1].shipmentCode, null);
  });

  test('the schema rejects unknown sort keys at the query boundary', async () => {
    const { recoverableCostListQuerySchema } = await import('@tingting/shared');
    assert.equal(recoverableCostListQuerySchema.safeParse({ sortBy: 'nonsense' }).success, false);
    assert.equal(recoverableCostListQuerySchema.safeParse({ sortBy: 'variance', sortDir: 'desc' }).success, true);
    assert.equal(recoverableCostListQuerySchema.safeParse({ sortBy: 'variance', sortDir: 'DESC' }).success, false);
  });
});
