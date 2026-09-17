/** Fuel variances inform reconciliation; they never gate direct expense recording. */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { db, client } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import { createTripExpense, updateTripExpense } from '../services/forwarder.service';
import { getFuelApReconciliation } from '../services/fuel-ap-recon.service';

async function fixture(run: (f: {
  supplier: typeof s.suppliers.$inferSelect;
  trip: typeof s.trips.$inferSelect;
  input: Parameters<typeof createTripExpense>[1];
}) => Promise<void>) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [supplier] = await db.insert(s.suppliers).values({ name: `M61 fuel ${suffix}`, isFuelSupplier: true }).returning();
  const [customer] = await db.insert(s.customers).values({ name: `M61 ${suffix}` }).returning();
  const [route] = await db.insert(s.routes).values({ name: `M61 ${suffix}` }).returning();
  const [trip] = await db.insert(s.trips).values({ tripCode: `M61-${suffix}`, customerId: customer.id, routeId: route.id, departureDate: '2026-09-15', status: 'IN_TRANSIT' }).returning();
  const [type] = await db.insert(s.forwarderExpenseTypes).values({ code: `FUEL-M61-${suffix}`, name: 'Fuel invoice', requiresInvoice: true }).returning();
  try {
    await run({ supplier, trip, input: { tripId: trip.id, forwarderId: null, expenseType: type.code,
      buyAmount: '500000', sellAmount: '0', supplierId: supplier.id, settlementMethod: 'COMPANY_DIRECT',
      invoiceNumber: `M61-${suffix}`, invoiceDate: '2026-09-15', expenseDate: '2026-09-15', note: null } });
  } finally {
    await db.delete(s.tripExpenses).where(eq(s.tripExpenses.tripId, trip.id));
    await db.delete(s.fuelReconExplanations).where(eq(s.fuelReconExplanations.supplierId, supplier.id));
    await db.delete(s.trips).where(eq(s.trips.id, trip.id));
    await db.delete(s.forwarderExpenseTypes).where(eq(s.forwarderExpenseTypes.id, type.id));
    await db.delete(s.routes).where(eq(s.routes.id, route.id));
    await db.delete(s.customers).where(eq(s.customers.id, customer.id));
    await db.delete(s.suppliers).where(eq(s.suppliers.id, supplier.id));
  }
}
const report = (supplierId: number) => getFuelApReconciliation({ from: '2026-09-01', to: '2026-09-30', supplierId });

test('a fuel variance without an explanation does not block the next direct expense', () => fixture(async f => {
  const first = await createTripExpense(db, f.input);
  assert.equal(first.approvalStatus, 'RECORDED');
  assert.equal(first.approvedBy, null);
  const before = await report(f.supplier.id);
  assert.equal(before.suppliers[0]?.status, 'VARIANCE');
  assert.equal(before.totals.invoicedFuelCost, 500000);
  assert.equal((await db.select().from(s.fuelReconExplanations).where(eq(s.fuelReconExplanations.supplierId, f.supplier.id))).length, 0);
  const second = await createTripExpense(db, { ...f.input, buyAmount: '200000', invoiceNumber: 'Second invoice' });
  assert.equal(second.approvalStatus, 'RECORDED');
  assert.equal((await report(f.supplier.id)).totals.invoicedFuelCost, 700000);
}));

test('correcting a fuel expense updates its report amount once without an approval step', () => fixture(async f => {
  const expense = await createTripExpense(db, f.input);
  const updated = await updateTripExpense(db, expense.id, { buyAmount: '400000', note: 'Corrected receipt amount' });
  assert.equal(updated?.approvalStatus, 'RECORDED');
  assert.equal(updated?.approvedBy, null);
  assert.equal((await report(f.supplier.id)).totals.invoicedFuelCost, 400000);
  assert.equal((await db.select().from(s.tripExpenses).where(eq(s.tripExpenses.tripId, f.trip.id))).length, 1);
}));

test('fuel report includes recorded and legacy posted amounts but excludes unrecorded or voided rows', () => fixture(async f => {
  await createTripExpense(db, f.input);
  await db.insert(s.tripExpenses).values(['APPROVED', 'DRAFT', 'PENDING', 'VOIDED', 'REJECTED'].map(approvalStatus => ({
    tripId: f.trip.id, expenseType: f.input.expenseType, supplierId: f.supplier.id, buyAmount: '100000', sellAmount: '0',
    invoiceDate: '2026-09-15', invoiceNumber: approvalStatus, approvalStatus,
  })));
  assert.equal((await report(f.supplier.id)).totals.invoicedFuelCost, 600000);
}));

test('historical explanations remain unchanged and do not suppress factual variance', () => fixture(async f => {
  const [history] = await db.insert(s.fuelReconExplanations).values({ supplierId: f.supplier.id,
    periodFrom: '2026-09-01', periodTo: '2026-09-30', explanationText: 'Historical supplier explanation', resolvedVariance: '123000' }).returning();
  await createTripExpense(db, f.input);
  const current = await report(f.supplier.id);
  assert.equal(current.suppliers[0]?.status, 'VARIANCE');
  assert.equal(current.totals.invoicedFuelCost, 500000);
  const [retained] = await db.select().from(s.fuelReconExplanations).where(eq(s.fuelReconExplanations.id, history.id));
  assert.deepEqual(retained, history);
}));

after(async () => { await disconnectRedis(); await client.end(); });
