/**
 * Wave 2 M3.5 — unapproved disbursement exclusion tests.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { insertTripComposite } from '../services/trip-composite.service';
import { assembleDisbursementsForPeriod } from '../services/disbursement-assembly.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdExpenseIds: number[] = [];
const createdTripIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];

let setupCounter = 0;
async function setup() {
  setupCounter++;
  const [customer] = await db.insert(s.customers).values({ name: `M35ex customer ${suffix}-${setupCounter}` }).returning();
  createdCustomerIds.push(customer.id);
  const [route] = await db.insert(s.routes).values({ name: `M35ex route ${suffix}` }).returning();
  createdRouteIds.push(route.id);
  const [cargo] = await db.insert(s.cargoTypes).values({ name: `M35ex cargo ${suffix}` }).returning();
  createdCargoTypeIds.push(cargo.id);
  const trip = await insertTripComposite(db, {
    tripCode: `M35EX-${suffix}-${setupCounter}`.slice(0, 50),
    customerId: customer.id, routeId: route.id, cargoTypeId: cargo.id,
    status: 'COMPLETED', departureDate: '2026-07-15', carrierType: 'OWN',
  });
  createdTripIds.push(trip.id);
  return { customer, trip };
}

async function mkExpense(tripId: number, status: 'PENDING' | 'APPROVED' | 'REJECTED') {
  const [e] = await db.insert(s.tripExpenses).values({
    tripId, expenseType: 'CHI_HO', buyAmount: '100000', sellAmount: '120000',
    settlementMethod: 'COMPANY_DIRECT', approvalStatus: status,
  }).returning();
  createdExpenseIds.push(e.id);
  return e;
}

after(async () => {
  try {
    if (createdExpenseIds.length > 0) await db.delete(s.tripExpenses).where(inArray(s.tripExpenses.id, createdExpenseIds));
    if (createdTripIds.length > 0) await db.delete(s.tripFinancialState).where(inArray(s.tripFinancialState.tripId, createdTripIds));
    if (createdTripIds.length > 0) await db.delete(s.tripCarrierInfo).where(inArray(s.tripCarrierInfo.tripId, createdTripIds));
    if (createdTripIds.length > 0) await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
    if (createdCargoTypeIds.length > 0) await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, createdCargoTypeIds));
    if (createdRouteIds.length > 0) await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
    if (createdCustomerIds.length > 0) await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
  } catch (err) { console.warn('[m35-exclusion] cleanup partial:', (err as Error).message); }
  await client.end();
});

describe('M3.5 — assembleDisbursementsForPeriod', () => {
  test('only APPROVED expenses in the approved list', async () => {
    const { customer, trip } = await setup();
    await mkExpense(trip.id, 'APPROVED');
    await mkExpense(trip.id, 'APPROVED');

    const result = await assembleDisbursementsForPeriod(customer.id, '2026-07-01', '2026-07-31');
    assert.equal(result.approved.length, 2);
    assert.equal(result.pending.length, 0);
  });

  test('PENDING expenses go to the pending list, not approved', async () => {
    const { customer, trip } = await setup();
    await mkExpense(trip.id, 'APPROVED');
    await mkExpense(trip.id, 'PENDING');

    const result = await assembleDisbursementsForPeriod(customer.id, '2026-07-01', '2026-07-31');
    assert.equal(result.approved.length, 1);
    assert.equal(result.pending.length, 1);
    assert.equal(result.pending[0].approvalStatus, 'PENDING');
  });

  test('REJECTED expenses go to the pending list', async () => {
    const { customer, trip } = await setup();
    await mkExpense(trip.id, 'REJECTED');

    const result = await assembleDisbursementsForPeriod(customer.id, '2026-07-01', '2026-07-31');
    assert.equal(result.approved.length, 0);
    assert.equal(result.pending.length, 1);
    assert.equal(result.pending[0].approvalStatus, 'REJECTED');
  });

  test('mixed statuses partition correctly', async () => {
    const { customer, trip } = await setup();
    await mkExpense(trip.id, 'APPROVED');
    await mkExpense(trip.id, 'APPROVED');
    await mkExpense(trip.id, 'PENDING');
    await mkExpense(trip.id, 'REJECTED');

    const result = await assembleDisbursementsForPeriod(customer.id, '2026-07-01', '2026-07-31');
    assert.equal(result.approved.length, 2);
    assert.equal(result.pending.length, 2);
  });

  test('empty when no expenses exist', async () => {
    const { customer } = await setup();
    const result = await assembleDisbursementsForPeriod(customer.id, '2026-07-01', '2026-07-31');
    assert.equal(result.approved.length, 0);
    assert.equal(result.pending.length, 0);
  });

  test('expenses outside the date range are excluded', async () => {
    const { customer, trip } = await setup();
    await mkExpense(trip.id, 'APPROVED');

    // Query a range that does NOT include the trip's departureDate (2026-07-15).
    const result = await assembleDisbursementsForPeriod(customer.id, '2026-08-01', '2026-08-31');
    assert.equal(result.approved.length, 0);
    assert.equal(result.pending.length, 0);
  });
});
