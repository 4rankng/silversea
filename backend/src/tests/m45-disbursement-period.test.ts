/**
 * Wave 2 M4.5 — disbursement period-allocation guard tests.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { insertTripComposite } from '../services/trip-composite.service';
import { checkDisbursementAllocation, assertCanAllocateDisbursement } from '../services/disbursement-period.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdExpenseIds: number[] = [];
const createdDocIds: number[] = [];
const createdLineIds: number[] = [];
const createdTripIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];

async function mkCustomer() {
  const [c] = await db.insert(s.customers).values({ name: `M45 customer ${suffix}-${createdCustomerIds.length}` }).returning();
  createdCustomerIds.push(c.id); return c;
}
async function mkTrip(customerId: number) {
  const [route] = await db.insert(s.routes).values({ name: `M45 route ${suffix}` }).returning();
  createdRouteIds.push(route.id);
  const [cargo] = await db.insert(s.cargoTypes).values({ name: `M45 cargo ${suffix}` }).returning();
  createdCargoTypeIds.push(cargo.id);
  const trip = await insertTripComposite(db, {
    tripCode: `M45-${suffix}-${createdTripIds.length}`.slice(0, 50),
    customerId, routeId: route.id, cargoTypeId: cargo.id,
    status: 'COMPLETED', departureDate: '2026-07-01', carrierType: 'OWN',
  });
  createdTripIds.push(trip.id); return trip;
}
async function mkExpense(tripId: number, status: 'PENDING' | 'APPROVED' | 'REJECTED') {
  const [e] = await db.insert(s.tripExpenses).values({
    tripId, expenseType: 'CHI_HO', buyAmount: '100000', sellAmount: '120000',
    settlementMethod: 'COMPANY_DIRECT', approvalStatus: status,
  }).returning();
  createdExpenseIds.push(e.id); return e;
}
async function mkBillingDoc(customerId: number) {
  const [d] = await db.insert(s.billingDocuments).values({
    type: 'DEBIT_NOTE', entityType: 'CUSTOMER', entityId: customerId,
    rangeFrom: '2026-07-01', rangeTo: '2026-07-31', totalInclVat: '1000000',
  }).returning();
  createdDocIds.push(d.id); return d;
}

after(async () => {
  try {
    if (createdLineIds.length > 0) await db.delete(s.billingDocumentLines).where(inArray(s.billingDocumentLines.id, createdLineIds));
    if (createdDocIds.length > 0) await db.delete(s.billingDocuments).where(inArray(s.billingDocuments.id, createdDocIds));
    if (createdExpenseIds.length > 0) await db.delete(s.tripExpenses).where(inArray(s.tripExpenses.id, createdExpenseIds));
    if (createdTripIds.length > 0) await db.delete(s.tripFinancialState).where(inArray(s.tripFinancialState.tripId, createdTripIds));
    if (createdTripIds.length > 0) await db.delete(s.tripCarrierInfo).where(inArray(s.tripCarrierInfo.tripId, createdTripIds));
    if (createdTripIds.length > 0) await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
    if (createdCargoTypeIds.length > 0) await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, createdCargoTypeIds));
    if (createdRouteIds.length > 0) await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
    if (createdCustomerIds.length > 0) await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
  } catch (err) { console.warn('[m45] cleanup partial:', (err as Error).message); }
  await client.end();
});

describe('M4.5 — checkDisbursementAllocation', () => {
  test('PENDING expense → approved=false', async () => {
    const customer = await mkCustomer();
    const trip = await mkTrip(customer.id);
    const expense = await mkExpense(trip.id, 'PENDING');
    const result = await checkDisbursementAllocation(expense.id);
    assert.equal(result.approved, false);
    assert.equal(result.alreadyAllocated, false);
  });

  test('APPROVED expense not on any doc → can allocate', async () => {
    const customer = await mkCustomer();
    const trip = await mkTrip(customer.id);
    const expense = await mkExpense(trip.id, 'APPROVED');
    const result = await checkDisbursementAllocation(expense.id);
    assert.equal(result.approved, true);
    assert.equal(result.alreadyAllocated, false);
  });

  test('APPROVED expense already on a billing doc → alreadyAllocated=true', async () => {
    const customer = await mkCustomer();
    const trip = await mkTrip(customer.id);
    const expense = await mkExpense(trip.id, 'APPROVED');
    const doc = await mkBillingDoc(customer.id);
    const [line] = await db.insert(s.billingDocumentLines).values({
      documentId: doc.id, sourceType: 'EXPENSE', sourceId: expense.id,
      lineType: 'SERVICE_FEE', description: 'Test', baseAmount: '120000',
    }).returning();
    createdLineIds.push(line.id);

    const result = await checkDisbursementAllocation(expense.id);
    assert.equal(result.approved, true);
    assert.equal(result.alreadyAllocated, true);
    assert.equal(result.allocatedDocumentId, doc.id);
  });

  test('excluded line does NOT count as allocated', async () => {
    const customer = await mkCustomer();
    const trip = await mkTrip(customer.id);
    const expense = await mkExpense(trip.id, 'APPROVED');
    const doc = await mkBillingDoc(customer.id);
    const [line] = await db.insert(s.billingDocumentLines).values({
      documentId: doc.id, sourceType: 'EXPENSE', sourceId: expense.id,
      lineType: 'SERVICE_FEE', description: 'Excluded', baseAmount: '120000',
      excluded: true,
    }).returning();
    createdLineIds.push(line.id);

    const result = await checkDisbursementAllocation(expense.id);
    assert.equal(result.alreadyAllocated, false, 'excluded line not counted');
  });
});

describe('M4.5 — assertCanAllocateDisbursement', () => {
  test('APPROVED + not allocated → does not throw', async () => {
    const customer = await mkCustomer();
    const trip = await mkTrip(customer.id);
    const expense = await mkExpense(trip.id, 'APPROVED');
    await assert.doesNotThrow(() => assertCanAllocateDisbursement(expense.id));
  });

  test('PENDING → throws 409', async () => {
    const customer = await mkCustomer();
    const trip = await mkTrip(customer.id);
    const expense = await mkExpense(trip.id, 'PENDING');
    await assert.rejects(
      () => assertCanAllocateDisbursement(expense.id),
      (err: unknown) => err instanceof Error && 'statusCode' in err && (err as { statusCode: number }).statusCode === 409,
    );
  });

  test('already allocated → throws 409', async () => {
    const customer = await mkCustomer();
    const trip = await mkTrip(customer.id);
    const expense = await mkExpense(trip.id, 'APPROVED');
    const doc = await mkBillingDoc(customer.id);
    const [line] = await db.insert(s.billingDocumentLines).values({
      documentId: doc.id, sourceType: 'EXPENSE', sourceId: expense.id,
      lineType: 'SERVICE_FEE', description: 'Allocated', baseAmount: '120000',
    }).returning();
    createdLineIds.push(line.id);

    await assert.rejects(
      () => assertCanAllocateDisbursement(expense.id),
      (err: unknown) => err instanceof Error && 'statusCode' in err && (err as { statusCode: number }).statusCode === 409,
    );
  });

  test('404 on missing expense', async () => {
    await assert.rejects(
      () => assertCanAllocateDisbursement(99_999_999),
      (err: unknown) => err instanceof Error && 'statusCode' in err && (err as { statusCode: number }).statusCode === 404,
    );
  });
});
