// Q10 conversions (card 20260922_78): fee-row deletion = soft + mandatory
// reason + actor + timestamp on the three converting surfaces. RED-first:
// these cases were watched failing against the hard-delete code.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { deleteTripExpenseInTx } from '../services/forwarder.service';
import { deleteInvoiceTracking } from '../services/invoice-tracking.service';
import { saveDebitEdits } from '../services/shipment-debit-detail.service';
import { deleteOpsExpense } from '../services/ops-expenses.service';
import { disconnectRedis } from '../lib/redis';

const suffix = `${Date.now()}-q10-${Math.random().toString(36).slice(2, 8)}`;

const customerIds: number[] = [];
const userIds: number[] = [];
const routeIds: number[] = [];
const shipmentIds: number[] = [];
const fulfillmentIds: number[] = [];
const tripIds: number[] = [];
const expenseIds: number[] = [];
const trackerIds: number[] = [];
const opsExpenseIds: number[] = [];
const idempotencyKeys: string[] = [];

async function baseFixture() {
  const [user] = await db.insert(s.users).values({ username: `q10-${suffix}-${userIds.length}`, passwordHash: 'test', role: Role.ACCOUNTANT, status: 'ACTIVE' }).returning();
  userIds.push(user.id);
  const [customer] = await db.insert(s.customers).values({ name: `Q10 customer ${suffix} ${customerIds.length}` }).returning();
  customerIds.push(customer.id);
  const [route] = await db.insert(s.routes).values({ name: `Q10 route ${suffix}` }).returning();
  routeIds.push(route.id);
  const [shipment] = await db.insert(s.shipments).values({ shipmentCode: `Q10-${suffix}-${shipmentIds.length}`, customerId: customer.id, status: 'DISPATCHED' }).returning();
  shipmentIds.push(shipment.id);
  return { user, customer, route, shipment };
}

async function tripFixture(input: { shipmentId: number; customerId: number; routeId: number; withFulfillment?: boolean; status?: 'CREATED' | 'IN_TRANSIT' | 'COMPLETED' | 'CANCELED' }) {
  let fulfillmentId: number | null = null;
  if (input.withFulfillment) {
    const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
      shipmentId: input.shipmentId,
      fulfillmentType: 'FCL_CONTAINER',
      cargoMode: 'FCL',
      sourceShipmentVersion: 1,
    }).returning();
    fulfillmentIds.push(fulfillment.id);
    fulfillmentId = fulfillment.id;
  }
  const [trip] = await db.insert(s.trips).values({
    tripCode: `Q10-T-${suffix}-${tripIds.length}`.slice(0, 50),
    customerId: input.customerId,
    routeId: input.routeId,
    shipmentId: input.shipmentId,
    fulfillmentId,
    status: input.status ?? 'COMPLETED',
    departureDate: '2026-09-22',
  }).returning();
  tripIds.push(trip.id);
  return trip;
}

async function expenseFixture(tripId: number, forwarderId: number | null) {
  const [expense] = await db.insert(s.tripExpenses).values({
    tripId,
    forwarderId,
    createdBy: userIds[0],
    expenseType: 'OTHER',
    buyAmount: '500000',
    sellAmount: '0',
    approvalStatus: 'RECORDED',
    settlementMethod: 'COMPANY_DIRECT',
  }).returning();
  expenseIds.push(expense.id);
  return expense;
}

after(async () => {
  // Card 20260922_52 — this hook used to delete trip_expenses FIRST, which
  // `invoice_tracking.expense_id` (FK, NO ACTION) rejects: the whole batch
  // aborted, the catch below swallowed it, and every run leaked its fixture
  // rows into the shared application DB. Those rows are what the operator saw
  // on /accounting/invoice-tracking on 23/09 — the placeholder invoice no.
  // "INV-EMPTY-<epoch>-q10-<rand>" and lot code "Q10-<epoch>-q10-<rand>-<n>".
  // Order is FK-driven now: trackers → expenses → trips → fulfillments →
  // ops-expense entries → shipments → routes → customers → users
  // (invoice_tracking also references trips and users, so it must go before
  // both; ops_expense_entries holds shipments with RESTRICT).
  try {
    await db.delete(s.invoiceTracking).where(inArray(s.invoiceTracking.id, trackerIds));
    await db.delete(s.tripExpenses).where(inArray(s.tripExpenses.id, expenseIds));
    await db.delete(s.trips).where(inArray(s.trips.id, tripIds));
    await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.id, fulfillmentIds));
    await db.delete(s.opsExpenseEntries).where(inArray(s.opsExpenseEntries.id, opsExpenseIds));
    await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
    await db.delete(s.routes).where(inArray(s.routes.id, routeIds));
    await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
    await db.delete(s.users).where(inArray(s.users.id, userIds));
    try {
      await db.delete(s.idempotencyKeys).where(inArray(s.idempotencyKeys.createdBy, userIds));
    } catch { /* best-effort */ }
  } catch (error) {
    // Never silent: a leaked fixture row reaches the UI, so a failed cleanup
    // must be loud enough to catch in the run's output.
    console.error('[q10-soft-delete] fixture cleanup failed — rows leaked into the shared DB:', error);
  }
  await client.end();
  await disconnectRedis();
});

describe('Q10 soft-delete conversions (card 20260922_78)', () => {
  test('forwarder delete soft-voids an approved-eligible row with reason, actor, timestamp', async () => {
    const f = await baseFixture();
    const [opsUser] = await db.insert(s.users).values({ username: `q10-ops-${suffix}-${userIds.length}`, passwordHash: 'test', role: Role.OPS, status: 'ACTIVE' }).returning();
    userIds.push(opsUser.id);
    const trip = await tripFixture({ shipmentId: f.shipment.id, customerId: f.customer.id, routeId: f.route.id, status: 'IN_TRANSIT' });
    await db.insert(s.userShipmentLinks).values({ userId: opsUser.id, shipmentId: f.shipment.id });
    const expense = await expenseFixture(trip.id, opsUser.id);
    await db.transaction(async (tx) => {
      await deleteTripExpenseInTx(tx, expense.id, opsUser.id, expense.updatedAt, 'Sai số lượng cần thu hồi', f.user.id);
    });
    const [row] = await db.select().from(s.tripExpenses).where(eq(s.tripExpenses.id, expense.id));
    assert.ok(row, 'the fee row must SURVIVE the delete (Q10 soft)');
    assert.equal(row.approvalStatus, 'VOIDED');
    assert.equal(row.deletionReason, 'Sai số lượng cần thu hồi');
    assert.equal(row.deletedBy, f.user.id);
    assert.ok(row.deletedAt, 'deletedAt recorded');
  });

  test('forwarder delete without a reason is rejected', async () => {
    const f = await baseFixture();
    // Mirror the soft-void fixture so, absent the reason guard, the delete
    // would SUCCEED (no rejection) — the assertion then discriminates the
    // guard itself, not an unrelated scope error.
    const [opsUser] = await db.insert(s.users).values({ username: `q10-ops-${suffix}-${userIds.length}`, passwordHash: 'test', role: Role.OPS, status: 'ACTIVE' }).returning();
    userIds.push(opsUser.id);
    const trip = await tripFixture({ shipmentId: f.shipment.id, customerId: f.customer.id, routeId: f.route.id, status: 'IN_TRANSIT' });
    await db.insert(s.userShipmentLinks).values({ userId: opsUser.id, shipmentId: f.shipment.id });
    const expense = await expenseFixture(trip.id, opsUser.id);
    // Whitespace-only must fail the trim guard, not slip through as "".
    await assert.rejects(
      db.transaction((tx) => deleteTripExpenseInTx(tx, expense.id, opsUser.id, expense.updatedAt, '   ', f.user.id)),
      (error: unknown) => typeof error === 'object' && error !== null && 'statusCode' in error && error.statusCode === 400,
    );
    const [row] = await db.select().from(s.tripExpenses).where(eq(s.tripExpenses.id, expense.id));
    assert.ok(row, 'nothing deleted when the reason is missing');
    assert.equal(row.approvalStatus, 'RECORDED');
    assert.ok(!row.deletedAt, 'deletedAt stays NULL on the rejected delete');
  });

  test('invoice-tracking delete soft-voids the tracker and its mirrored fee row', async () => {
    const f = await baseFixture();
    const trip = await tripFixture({ shipmentId: f.shipment.id, customerId: f.customer.id, routeId: f.route.id });
    const mirror = await expenseFixture(trip.id, null);
    const [tracker] = await db.insert(s.invoiceTracking).values({
      shipmentId: f.shipment.id,
      tripId: trip.id,
      expenseId: mirror.id,
      invoiceNumber: `INV-${suffix}`,
      invoiceAmount: '1200000',
      supplierPayment: '800000',
      progress: 'CHUA_GUI',
      createdBy: f.user.id,
    }).returning();
    trackerIds.push(tracker.id);
    await deleteInvoiceTracking(f.user.id, tracker.id, 'Khách hủy lô, hạch toán nhầm');
    const [trackerRow] = await db.select().from(s.invoiceTracking).where(eq(s.invoiceTracking.id, tracker.id));
    assert.ok(trackerRow, 'the tracker row must SURVIVE (Q10 soft)');
    assert.ok(trackerRow.deletedAt, 'tracker deletedAt recorded');
    assert.equal(trackerRow.deletionReason, 'Khách hủy lô, hạch toán nhầm');
    assert.equal(trackerRow.deletedBy, f.user.id);
    const [mirrorRow] = await db.select().from(s.tripExpenses).where(eq(s.tripExpenses.id, mirror.id));
    assert.ok(mirrorRow, 'the mirrored fee row must SURVIVE (no more physical delete)');
    assert.equal(mirrorRow.approvalStatus, 'VOIDED');
    assert.equal(mirrorRow.deletionReason, 'Khách hủy lô, hạch toán nhầm');
    assert.equal(mirrorRow.deletedBy, f.user.id);
  });

  test('invoice-tracking delete without a reason is rejected', async () => {
    const f = await baseFixture();
    const trip = await tripFixture({ shipmentId: f.shipment.id, customerId: f.customer.id, routeId: f.route.id });
    const mirror = await expenseFixture(trip.id, null);
    const [tracker] = await db.insert(s.invoiceTracking).values({
      shipmentId: f.shipment.id,
      tripId: trip.id,
      expenseId: mirror.id,
      invoiceNumber: `INV-EMPTY-${suffix}`,
      invoiceAmount: '100000',
      supplierPayment: '50000',
      progress: 'CHUA_GUI',
      createdBy: f.user.id,
    }).returning();
    trackerIds.push(tracker.id);
    await assert.rejects(
      () => deleteInvoiceTracking(f.user.id, tracker.id, ''),
      (error: unknown) => (error as { statusCode?: number }).statusCode === 400,
    );
  });

  test('debit-edits removal soft-voids the fee row with reason, actor, timestamp', async () => {
    const f = await baseFixture();
    const trip = await tripFixture({ shipmentId: f.shipment.id, customerId: f.customer.id, routeId: f.route.id, withFulfillment: true });
    const expense = await expenseFixture(trip.id, null);
    const idempotencyKey = `q10-debit-${suffix}-${expense.id}`;
    idempotencyKeys.push(idempotencyKey);
    await saveDebitEdits({
      shipmentId: f.shipment.id,
      actorId: f.user.id,
      idempotencyKey,
      payload: { removeExpenseIds: [expense.id], removalReason: 'Kế toán chọn nhầm dòng chi hộ' },
    });
    const [row] = await db.select().from(s.tripExpenses).where(eq(s.tripExpenses.id, expense.id));
    assert.ok(row, 'the fee row must SURVIVE the removal (Q10 soft)');
    assert.equal(row.approvalStatus, 'VOIDED');
    assert.equal(row.deletionReason, 'Kế toán chọn nhầm dòng chi hộ');
    assert.equal(row.deletedBy, f.user.id);
    assert.ok(row.deletedAt, 'deletedAt recorded');
  });

  test('debit-edits removal without a reason is rejected', async () => {    const f = await baseFixture();
    const trip = await tripFixture({ shipmentId: f.shipment.id, customerId: f.customer.id, routeId: f.route.id, withFulfillment: true });
    const expense = await expenseFixture(trip.id, null);
    const idempotencyKey = `q10-debit-empty-${suffix}-${expense.id}`;
    idempotencyKeys.push(idempotencyKey);
    await assert.rejects(
      () => saveDebitEdits({
        shipmentId: f.shipment.id,
        actorId: f.user.id,
        idempotencyKey,
        payload: { removeExpenseIds: [expense.id] },
      }),
      (error: unknown) => (error as { statusCode?: number }).statusCode === 400,
    );
    const [row] = await db.select().from(s.tripExpenses).where(eq(s.tripExpenses.id, expense.id));
    assert.ok(row, 'nothing deleted when the reason is missing');
    assert.equal(row.approvalStatus, 'RECORDED');
  });

  test('ops expense delete soft-voids with reason, actor, timestamp', async () => {
    const f = await baseFixture();
    const [entry] = await db.insert(s.opsExpenseEntries).values({
      shipmentId: f.shipment.id,
      expenseTypeCode: 'ZONE_SURCHARGE',
      amount: '300000',
      paidById: f.user.id,
      paidAt: '2026-09-22',
    }).returning();
    opsExpenseIds.push(entry.id);
    await deleteOpsExpense(f.user.id, entry.id, 'Nhập trùng khoản chi hộ', undefined);
    const [row] = await db.select().from(s.opsExpenseEntries).where(eq(s.opsExpenseEntries.id, entry.id));
    assert.ok(row, 'the ops expense row must SURVIVE the delete');
    assert.equal(row.approvalStatus, 'VOIDED');
    assert.equal(row.deletionReason, 'Nhập trùng khoản chi hộ');
    assert.equal(row.deletedBy, f.user.id);
  });

  test('ops expense delete without a reason is rejected', async () => {
    const f = await baseFixture();
    const [entry] = await db.insert(s.opsExpenseEntries).values({
      shipmentId: f.shipment.id,
      expenseTypeCode: 'ZONE_SURCHARGE',
      amount: '300000',
      paidById: f.user.id,
      paidAt: '2026-09-22',
    }).returning();
    opsExpenseIds.push(entry.id);
    await assert.rejects(
      () => deleteOpsExpense(f.user.id, entry.id, '', undefined),
      (error: unknown) => (error as { statusCode?: number }).statusCode === 400,
    );
  });
});
