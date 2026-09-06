/**
 * Wave 2 M3.5 — billing line assembly tests.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { insertTripComposite } from '../services/trip-composite.service';
import { assembleBillingLines } from '../services/billing-line-assembly.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdIds: number[] = [];

async function setup() {
  const [customer] = await db.insert(s.customers).values({ name: `M35ba customer ${suffix}-${createdIds.length}` }).returning();
  const [route] = await db.insert(s.routes).values({ name: `M35ba route ${suffix}` }).returning();
  const [cargo] = await db.insert(s.cargoTypes).values({ name: `M35ba cargo ${suffix}` }).returning();
  const trip = await insertTripComposite(db, {
    tripCode: `M35BA-${suffix}-${createdIds.length}`.slice(0, 50),
    customerId: customer.id, routeId: route.id, cargoTypeId: cargo.id,
    status: 'COMPLETED', departureDate: '2026-07-15', carrierType: 'OWN',
    revenue: '5000000', revenueEmptyReturn: '5000000', revenueCombine: '0',
    revenueOriginal: '5000000', pricingSource: 'TABLE',
  });
  createdIds.push(customer.id, route.id, cargo.id, trip.id);
  return { customer, route, cargo, trip };
}

after(async () => {
  // Cleanup in reverse FK order. createdIds is a flat list mixed types.
  // We'll just delete from each table by any of the ids — safe because
  // ids are unique across tables (serial PKs).
  try {
    // Clean up expenses/ancillary first (no FK to route/cargo)
    await db.delete(s.tripExpenses).where(inArray(s.tripExpenses.tripId, createdIds));
    await db.delete(s.ancillaryRevenue).where(inArray(s.ancillaryRevenue.customerId, createdIds));
    await db.delete(s.tripFinancialState).where(inArray(s.tripFinancialState.tripId, createdIds));
    await db.delete(s.tripCarrierInfo).where(inArray(s.tripCarrierInfo.tripId, createdIds));
    await db.delete(s.trips).where(inArray(s.trips.id, createdIds));
    await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, createdIds));
    await db.delete(s.routes).where(inArray(s.routes.id, createdIds));
    await db.delete(s.customers).where(inArray(s.customers.id, createdIds));
  } catch (err) { console.warn('[m35-billing-assembly] cleanup partial:', (err as Error).message); }
  await client.end();
});

describe('M3.5 — assembleBillingLines', () => {
  test('assembles freight line from a completed trip', async () => {
    const { customer, trip } = await setup();
    const result = await assembleBillingLines(customer.id, '2026-07-01', '2026-07-31');
    const freightLines = result.lines.filter(l => l.lineType === 'FREIGHT');
    assert.ok(freightLines.length >= 1, 'at least one freight line');
    assert.ok(freightLines.some(l => l.sourceId === trip.id && l.baseAmount === 5_000_000));
  });

  test('includes ancillary revenue lines', async () => {
    const { customer } = await setup();
    const [rev] = await db.insert(s.ancillaryRevenue).values({
      customerId: customer.id, type: 'LCL', amount: '300000', date: '2026-07-10',
    }).returning();
    createdIds.push(rev.id);
    const result = await assembleBillingLines(customer.id, '2026-07-01', '2026-07-31');
    const ancillaryLines = result.lines.filter(l => l.lineType === 'ANCILLARY');
    assert.ok(ancillaryLines.some(l => l.sourceId === rev.id && l.baseAmount === 300_000));
  });

  test('totalBase sums all lines', async () => {
    const { customer } = await setup();
    const result = await assembleBillingLines(customer.id, '2026-07-01', '2026-07-31');
    const manualSum = result.lines.reduce((s, l) => s + l.baseAmount, 0);
    assert.equal(result.totalBase, manualSum);
  });

  test('empty when no trips/expenses/ancillary in range', async () => {
    const [customer] = await db.insert(s.customers).values({ name: `M35ba-empty-${suffix}` }).returning();
    createdIds.push(customer.id);
    const result = await assembleBillingLines(customer.id, '2026-07-01', '2026-07-31');
    assert.equal(result.lines.length, 0);
    assert.equal(result.totalBase, 0);
  });

  test('pending disbursements are reported but not in lines', async () => {
    const { customer, trip } = await setup();
    const [expense] = await db.insert(s.tripExpenses).values({
      tripId: trip.id, expenseType: 'CHI_HO', buyAmount: '100000', sellAmount: '120000',
      settlementMethod: 'COMPANY_DIRECT', approvalStatus: 'PENDING',
    }).returning();
    createdIds.push(expense.id);
    const result = await assembleBillingLines(customer.id, '2026-07-01', '2026-07-31');
    // The PENDING expense should NOT be in lines.
    const expenseLines = result.lines.filter(l => l.lineType === 'SERVICE_FEE');
    assert.ok(!expenseLines.some(l => l.sourceId === expense.id), 'PENDING not in lines');
    // But it should be in pendingDisbursements.
    assert.ok(result.pendingDisbursements.some(p => p.id === expense.id), 'PENDING in pendingDisbursements');
  });
});
