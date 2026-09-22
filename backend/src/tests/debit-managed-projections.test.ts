import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { shipmentDebitDetailSchema } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import { disconnectRedis } from '../lib/redis';
import { getShipmentDebitDetail, saveDebitEdits } from '../services/shipment-debit-detail.service';

const cleanup: Array<() => Promise<unknown>> = [];
const prefix = `managed-debit-${Date.now()}`;
after(async () => { try { for (const remove of cleanup) await remove(); } finally { await disconnectRedis(); await client.end(); } });

test('canonical copies reject direct edits/deletes atomically while manual and TRIP self-links remain editable', async () => {
  const [user] = await db.insert(s.users).values({ username: prefix, passwordHash: 'test', role: 'ACCOUNTANT' }).returning(); cleanup.unshift(() => db.delete(s.users).where(eq(s.users.id, user.id)));
  const [customer] = await db.insert(s.customers).values({ name: prefix }).returning(); cleanup.unshift(() => db.delete(s.customers).where(eq(s.customers.id, customer.id)));
  const [route] = await db.insert(s.routes).values({ name: prefix }).returning(); cleanup.unshift(() => db.delete(s.routes).where(eq(s.routes.id, route.id)));
  const [lot] = await db.insert(s.shipments).values({ customerId: customer.id }).returning(); cleanup.unshift(() => db.delete(s.shipments).where(eq(s.shipments.id, lot.id)));
  const [work] = await db.insert(s.shipmentFulfillments).values({ shipmentId: lot.id, fulfillmentType: 'FCL_CONTAINER', cargoMode: 'FCL', sourceShipmentVersion: 1 }).returning(); cleanup.unshift(() => db.delete(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, work.id)));
  const [trip] = await db.insert(s.trips).values({ shipmentId: lot.id, fulfillmentId: work.id, customerId: customer.id, routeId: route.id, departureDate: '2026-09-22' }).returning(); cleanup.unshift(() => db.delete(s.trips).where(eq(s.trips.id, trip.id)));
  const [driver] = await db.insert(s.drivers).values({ name: prefix }).returning(); cleanup.unshift(() => db.delete(s.drivers).where(eq(s.drivers.id, driver.id)));
  const rows = await db.insert(s.tripExpenses).values(['OPS', 'DRIVER', 'INVOICE', 'manual', 'TRIP'].map(feeName => ({ tripId: trip.id, expenseType: 'OTHER', feeName, buyAmount: '100', sellAmount: '120' }))).returning(); cleanup.unshift(() => db.delete(s.tripExpenses).where(eq(s.tripExpenses.tripId, trip.id)));
  const [ops] = await db.insert(s.opsExpenseEntries).values({ shipmentId: lot.id, expenseTypeCode: 'QA', amount: '100', customerChargeAmount: '120', paidById: user.id, paidAt: '2026-09-22' }).returning(); cleanup.unshift(() => db.delete(s.opsExpenseEntries).where(eq(s.opsExpenseEntries.id, ops.id)));
  const [cost] = await db.insert(s.driverIncidentalCosts).values({ tripId: trip.id, driverId: driver.id, costType: 'OTHER', amount: '100', customerChargeAmount: '120', occurredAt: '2026-09-22' }).returning(); cleanup.unshift(() => db.delete(s.driverIncidentalCosts).where(eq(s.driverIncidentalCosts.id, cost.id)));
  const [invoice] = await db.insert(s.invoiceTracking).values({ shipmentId: lot.id, tripId: trip.id, expenseId: rows[2].id, invoiceNumber: prefix, invoiceAmount: '120', supplierPayment: '100' }).returning(); cleanup.unshift(() => db.delete(s.invoiceTracking).where(eq(s.invoiceTracking.id, invoice.id)));
  await db.insert(s.expenseAccountingSources).values([
    { sourceKind: 'OPS', sourceId: ops.id, linkedTripExpenseId: rows[0].id, confirmedAt: new Date() },
    { sourceKind: 'DRIVER', sourceId: cost.id, linkedTripExpenseId: rows[1].id },
    { sourceKind: 'INVOICE', sourceId: invoice.id, linkedTripExpenseId: rows[2].id },
    { sourceKind: 'TRIP', sourceId: rows[4].id, linkedTripExpenseId: rows[4].id },
  ].map(row => ({ ...row, shipmentId: lot.id, tripId: trip.id })) as Array<typeof s.expenseAccountingSources.$inferInsert>);
  cleanup.unshift(() => db.delete(s.expenseAccountingSources).where(eq(s.expenseAccountingSources.shipmentId, lot.id)));
  cleanup.unshift(() => db.delete(s.idempotencyKeys).where(eq(s.idempotencyKeys.createdBy, user.id)));
  cleanup.unshift(() => db.delete(s.auditLogs).where(eq(s.auditLogs.userId, user.id)));
  let attempt = 0;
  const save = (payload: Record<string, unknown>) => saveDebitEdits({ shipmentId: lot.id, actorId: user.id, idempotencyKey: `${prefix}-${++attempt}`, payload });
  for (const row of rows.slice(0, 3)) {
    for (const payload of [
      { edits: [{ expenseId: rows[3].id, buyAmount: 777 }, { expenseId: row.id, buyAmount: 500, sellAmount: 600, note: 'bypass' }] },
      { edits: [{ expenseId: rows[3].id, buyAmount: 777 }], removeExpenseIds: [row.id] },
    ]) {
      await assert.rejects(() => save(payload), (error: unknown) => error instanceof ApiError && error.statusCode === 409);
      assert.deepEqual(await db.select().from(s.tripExpenses).where(eq(s.tripExpenses.id, row.id)), [row]);
      assert.equal((await db.select().from(s.tripExpenses).where(eq(s.tripExpenses.id, rows[3].id)))[0].buyAmount, '100', 'mixed request rolls back manual changes');
    }
  }
  const detail = shipmentDebitDetailSchema.parse(await getShipmentDebitDetail(lot.id));
  const fees = detail.chiHoRows.flatMap(row => row.otherFees);
  for (const row of rows.slice(0, 3)) assert.equal(fees.find(fee => fee.id === row.id)?.readOnly, true);
  for (const row of rows.slice(3)) assert.notEqual(fees.find(fee => fee.id === row.id)?.readOnly, true);
  await save({ edits: rows.slice(3).map(row => ({ expenseId: row.id, buyAmount: 150, sellAmount: 180 })) });
  for (const row of rows.slice(3)) assert.equal((await db.select().from(s.tripExpenses).where(eq(s.tripExpenses.id, row.id)))[0].sellAmount, '180');
  await save({ removeExpenseIds: [rows[3].id] });
  assert.equal((await db.select().from(s.tripExpenses).where(eq(s.tripExpenses.id, rows[3].id))).length, 0);
  assert.equal((await db.select().from(s.opsExpenseEntries).where(eq(s.opsExpenseEntries.id, ops.id)))[0].amount, '100');
  assert.equal((await db.select().from(s.driverIncidentalCosts).where(eq(s.driverIncidentalCosts.id, cost.id)))[0].amount, '100');
  assert.equal((await db.select().from(s.invoiceTracking).where(eq(s.invoiceTracking.id, invoice.id)))[0].supplierPayment, '100');
});
