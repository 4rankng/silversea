/** Direct expense recording keeps input validation, ownership and accounting locks. */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import type { Tx } from '../services/trip-shared';
import { createTripExpense, updateTripExpense, updateForwarderTripExpenseInTx } from '../services/forwarder.service';

async function isolated(run: (tx: Tx) => Promise<void>) {
  const rollback = new Error('rollback direct invoice fixture');
  try { await db.transaction(async tx => { await run(tx); throw rollback; }); }
  catch (error) { if (error !== rollback) throw error; }
}
async function fixture(tx: Tx) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [owner, other] = await tx.insert(s.users).values([
    { username: `m46-owner-${suffix}`, passwordHash: 'test', role: Role.OPS, status: 'ACTIVE' },
    { username: `m46-other-${suffix}`, passwordHash: 'test', role: Role.OPS, status: 'ACTIVE' },
  ]).returning();
  const [customer] = await tx.insert(s.customers).values({ name: `M46-${suffix}` }).returning();
  const [route] = await tx.insert(s.routes).values({ name: `M46-${suffix}` }).returning();
  const [shipment] = await tx.insert(s.shipments).values({ shipmentCode: `M46-${suffix}`, customerId: customer.id, status: 'DISPATCHED' }).returning();
  const [trip] = await tx.insert(s.trips).values({ tripCode: `M46-${suffix}`, customerId: customer.id, routeId: route.id, shipmentId: shipment.id, departureDate: '2026-09-15', status: 'IN_TRANSIT' }).returning();
  await tx.insert(s.userShipmentLinks).values({ userId: owner.id, shipmentId: shipment.id });
  const [type] = await tx.insert(s.forwarderExpenseTypes).values({ code: `M46-${suffix}`, name: 'Required invoice', requiresInvoice: true }).returning();
  const input = { tripId: trip.id, forwarderId: owner.id, createdBy: owner.id, expenseType: type.code,
    buyAmount: '500000', sellAmount: '300000', invoiceNumber: 'INV-RECORD', note: null };
  return { owner, other, shipment, trip, input };
}

test('records invoice details directly without an approval actor, even before the invoice date is supplied', () => isolated(async tx => {
  const f = await fixture(tx);
  const expense = await createTripExpense(tx, f.input);
  assert.equal(expense.approvalStatus, 'RECORDED');
  assert.equal(expense.invoiceDate, null);
  assert.equal(expense.buyAmount, '500000');
  assert.equal(expense.sellAmount, '300000');
  assert.equal(expense.approvedBy, null);
  assert.equal(expense.approvedAt, null);
  assert.equal(expense.returnForEvidenceReason, null);
  const updated = await updateTripExpense(tx, expense.id, { invoiceDate: '2026-09-15', note: 'Invoice received' });
  assert.equal(updated?.approvalStatus, 'RECORDED');
  assert.equal(updated?.invoiceDate, '2026-09-15');
  assert.equal(updated?.version, expense.version + 1);
  const rows = await tx.select().from(s.tripExpenses).where(eq(s.tripExpenses.tripId, f.trip.id));
  assert.equal(rows.length, 1, 'adding invoice details keeps one cost source');
}));

test('missing required invoice number still rejects creation without inserting a cost', () => isolated(async tx => {
  const f = await fixture(tx);
  await assert.rejects(createTripExpense(tx, { ...f.input, invoiceNumber: null }), /bắt buộc phải có hóa đơn/);
  assert.equal((await tx.select().from(s.tripExpenses).where(eq(s.tripExpenses.tripId, f.trip.id))).length, 0);
}));

test('removing a required invoice number rejects without overwriting the recorded expense', () => isolated(async tx => {
  const f = await fixture(tx);
  const expense = await createTripExpense(tx, f.input);
  await assert.rejects(updateTripExpense(tx, expense.id, { invoiceNumber: '' }), /bắt buộc phải có hóa đơn/);
  const [saved] = await tx.select().from(s.tripExpenses).where(eq(s.tripExpenses.id, expense.id));
  assert.equal(saved.invoiceNumber, 'INV-RECORD');
  assert.equal(saved.approvalStatus, 'RECORDED');
  assert.equal(saved.version, expense.version);
}));

test('direct invoice updates retain ownership and stale-version checks', () => isolated(async tx => {
  const f = await fixture(tx);
  const expense = await createTripExpense(tx, f.input);
  await assert.rejects(updateForwarderTripExpenseInTx(tx, expense.id, f.other.id, { note: 'Not mine' }, expense.updatedAt),
    (error: Error & { statusCode?: number }) => error.statusCode === 403);
  await assert.rejects(updateForwarderTripExpenseInTx(tx, expense.id, f.owner.id, { note: 'Stale' }, new Date(0)),
    (error: Error & { statusCode?: number }) => error.statusCode === 409);
  const saved = await updateForwarderTripExpenseInTx(tx, expense.id, f.owner.id, { note: 'Owner correction' }, expense.updatedAt);
  assert.equal(saved?.note, 'Owner correction');
  assert.equal(saved?.approvalStatus, 'RECORDED');
}));

test('accounting-locked shipment blocks both create and update without an approval detour', () => isolated(async tx => {
  const f = await fixture(tx);
  const expense = await createTripExpense(tx, f.input);
  await tx.insert(s.shipmentAccountingLocks).values({
    shipmentId: f.shipment.id, billingDocumentId: 0, billingDocumentVersion: 1,
    billingPeriodSnapshot: { rangeFrom: '2026-09-01', rangeTo: '2026-09-30', issuedAt: '2026-09-16T00:00:00.000Z' },
    shipmentVersionAtLock: f.shipment.version, reason: 'Recorded accounting lock fixture', activatedBy: f.owner.id,
  });
  for (const command of [() => createTripExpense(tx, f.input), () => updateTripExpense(tx, expense.id, { buyAmount: '600000' })]) {
    await assert.rejects(command(), (error: Error & { statusCode?: number }) => error.statusCode === 409 && !/phê duyệt/.test(error.message));
  }
  const [saved] = await tx.select().from(s.tripExpenses).where(eq(s.tripExpenses.id, expense.id));
  assert.equal(saved.buyAmount, '500000');
  assert.equal(saved.version, expense.version);
}));

after(async () => { await disconnectRedis(); await client.end(); });
