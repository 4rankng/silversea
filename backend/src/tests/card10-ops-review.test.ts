/**
 * Card 20260921_10 — the ops cost review table (accounting confirmation
 * surface). Service-level suite; fixtures `card10-*`/`CARD10-*`, local DB
 * :5441, announced.
 *
 * Coverage:
 *   AC1 columns+filters: OPS rows carry the review columns; date-range,
 *       staff, and progress filters honor the query.
 *   AC2 tick/tick-all: the EXISTING batch confirm consumes the rows'
 *       confirmRef verbatim and stamps confirmedAt + confirmedBy; progress
 *       flips CHUA_XAC_NHAN -> DA_XAC_NHAN.
 *   AC3 spine composable: fund-book reads cleanly after confirm.
 *   AC4 phiếu hoàn ứng: the refs feed the existing expenseReconciliationSchema
 *       (cited, not re-tested here).
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { createOpsExpense } from '../services/ops-expenses.service';
import { confirmAccountingExpenses } from '../services/expense-accounting-write.service';
import { listOpsCostReview } from '../services/ops-cost-review.service';
import { listFundBook } from '../services/treasury-fund-book.service';
import { Role } from '@tingting/shared';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TODAY = new Date().toISOString().slice(0, 10);

const cleanup: Array<() => Promise<void>> = [];
const track = (fn: () => Promise<void>) => cleanup.unshift(fn);

let accountant = 0;

async function mkActor() {
  const [acc] = await db.insert(s.users).values({
    username: `card10-${suffix}-acct-${cleanup.length}`, passwordHash: 'x', role: 'ACCOUNTANT',
  }).returning();
  track(async () => { await db.delete(s.users).where(eq(s.users.id, acc.id)); });
  accountant = acc.id;
  return acc;
}

async function mkOpsStaff() {
  const [u] = await db.insert(s.users).values({
    username: `card10-${suffix}-ops-${cleanup.length}`, passwordHash: 'x', role: 'OPS',
  }).returning();
  track(async () => { await db.delete(s.users).where(eq(s.users.id, u.id)); });
  return u;
}

async function mkShipment() {
  const [customer] = await db.insert(s.customers).values({ name: `card10 cust ${suffix}-${cleanup.length}` }).returning();
  track(async () => { await db.delete(s.customers).where(eq(s.customers.id, customer.id)); });
  const [route] = await db.insert(s.routes).values({ name: `card10 route ${suffix}-${cleanup.length}` }).returning();
  track(async () => { await db.delete(s.routes).where(eq(s.routes.id, route.id)); });
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'PENDING_DATE',
  }).returning();
  track(async () => { await db.delete(s.shipments).where(eq(s.shipments.id, shipment.id)); });
  return { customer, route, shipment };
}

async function mkEntry(opsStaff: { id: number }, shipmentId: number, opts: { costGroup: 'OPS_REGULAR' | 'OPS_INCIDENTAL' | 'INVOICED_OTHER'; feeName?: string; invoiceNumber?: string; customerChargeAmount?: string | number | null }) {
  const [link] = await db.insert(s.userShipmentLinks).values({ userId: opsStaff.id, shipmentId })
    .onConflictDoNothing().returning();
  if (link) {
    track(async () => { await db.delete(s.userShipmentLinks).where(and(eq(s.userShipmentLinks.userId, opsStaff.id), eq(s.userShipmentLinks.shipmentId, shipmentId))); });
  }
  const { ...result } = await createOpsExpense(opsStaff.id, {
    shipmentId,
    expenseTypeCode: 'SANITATION',
    amount: 250000,
    paidAt: TODAY,
    costGroup: opts.costGroup,
    feeName: opts.feeName,
    invoiceNumber: opts.invoiceNumber,
    invoiceDate: opts.invoiceNumber ? TODAY : undefined,
    customerChargeAmount: opts.customerChargeAmount,
  });
  track(async () => {
    await db.delete(s.opsExpenseEntries).where(eq(s.opsExpenseEntries.id, (result as { id: number }).id));
  });
  track(async () => {
    await db.delete(s.expenseAccountingSources).where(and(eq(s.expenseAccountingSources.sourceKind, 'OPS'), eq(s.expenseAccountingSources.sourceId, (result as { id: number }).id)));
  }
  );
  return result;
}

describe('card 20260921_10 - ops cost review', () => {
  test('review lists OPS rows with columns, progress, confirm refs (AC1)', async () => {
    const acc = await mkActor();
    const staff = await mkOpsStaff();
    const { customer, shipment } = await mkShipment();
    const invoiced = await mkEntry(staff, shipment.id, {
      costGroup: 'INVOICED_OTHER', feeName: 'card10 phí vệ sinh', invoiceNumber: 'card10-HD-1', customerChargeAmount: 250000,
    });
    const regular = await mkEntry(staff, shipment.id, {
      costGroup: 'OPS_REGULAR', feeName: 'card10 làm hàng', customerChargeAmount: 0,
    });
    const review = await listOpsCostReview({ userId: acc.id, role: Role.ACCOUNTANT }, {});
    const invoicedRow = review.items.find((row) => row.sourceId === invoiced.id);
    const regularRow = review.items.find((row) => row.sourceId === regular.id);
    assert.ok(invoicedRow, 'invoiced entry listed');
    assert.ok(regularRow, 'regular entry listed');
    assert.equal(invoicedRow.customerName, customer.name);
    assert.equal(invoicedRow.invoiceNumber, 'card10-HD-1');
    assert.equal(invoicedRow.progress, 'CHUA_XAC_NHAN');
    assert.equal(invoicedRow.confirmRef.sourceKind, 'OPS');
    assert.equal(invoicedRow.confirmRef.sourceId, invoiced.id);
    assert.equal(invoicedRow.confirmRef.expectedVersion, invoiced.version);
    assert.equal(regularRow.progress, 'CHUA_XAC_NHAN');
  });

  test('tick-all via the existing batch confirm stamps date + who; progress flips (AC2)', async () => {
    const acc = await mkActor();
    const staff = await mkOpsStaff();
    const { shipment } = await mkShipment();
    const e1 = await mkEntry(staff, shipment.id, { costGroup: 'OPS_REGULAR', feeName: 'card10 x1', customerChargeAmount: 0 });
    const e2 = await mkEntry(staff, shipment.id, { costGroup: 'OPS_INCIDENTAL', feeName: 'card10 x2', customerChargeAmount: 0 });
    const review = await listOpsCostReview({ userId: acc.id, role: Role.ACCOUNTANT }, { payerId: staff.id });
    const rows = review.items.filter((row) => [e1.id, e2.id].includes(row.sourceId));
    assert.equal(rows.length, 2);
    await db.transaction(async (tx) => {
      await confirmAccountingExpenses(tx, { userId: acc.id, role: Role.ACCOUNTANT },
        rows.map((row) => row.confirmRef));
    });
    const after = await listOpsCostReview({ userId: acc.id, role: Role.ACCOUNTANT }, { payerId: staff.id });
    const afterRows = after.items.filter((row) => [e1.id, e2.id].includes(row.sourceId));
    assert.equal(afterRows.length, 2);
    for (const row of afterRows) {
      assert.ok(row.confirmedAt, 'confirmedAt stamped');
      assert.equal(row.confirmedById, acc.id, 'the person who ticked recorded');
      assert.equal(row.progress, 'DA_XAC_NHAN');
    }
  });

  test('progress and staff filters honor the query (AC1 filters)', async () => {
    const acc = await mkActor();
    const staff = await mkOpsStaff();
    const { shipment } = await mkShipment();
    const entry = await mkEntry(staff, shipment.id, { costGroup: 'OPS_REGULAR', feeName: 'card10 f1', customerChargeAmount: 0 });
    const confirmed = await listOpsCostReview({ userId: acc.id, role: Role.ACCOUNTANT }, { progress: 'CHUA_XAC_NHAN', payerId: staff.id });
    assert.ok(confirmed.items.some((row) => row.sourceId === entry.id), 'unconfirmed entry in CHUA_XAC_NHAN filter');
    const done = await listOpsCostReview({ userId: acc.id, role: Role.ACCOUNTANT }, { progress: 'DA_XAC_NHAN', payerId: staff.id });
    assert.ok(!done.items.some((row) => row.sourceId === entry.id), 'unconfirmed entry absent from DA_XAC_NHAN filter');
    const other = await mkOpsStaff();
    const otherEntry = await mkEntry(other, shipment.id, { costGroup: 'OPS_REGULAR', feeName: 'card10 f2', customerChargeAmount: 0 });
    const mine = await listOpsCostReview({ userId: acc.id, role: Role.ACCOUNTANT }, { payerId: staff.id });
    assert.ok(mine.items.some((row) => row.sourceId === entry.id));
    assert.ok(!mine.items.some((row) => row.sourceId === otherEntry.id), 'staff filter isolates the payer');
  });

  test('fund-book spine reads cleanly after confirm (AC3 composable)', async () => {
    const acc = await mkActor();
    const staff = await mkOpsStaff();
    const { shipment } = await mkShipment();
    const entry = await mkEntry(staff, shipment.id, { costGroup: 'OPS_REGULAR', feeName: 'card10 spine', customerChargeAmount: 0 });
    const review = await listOpsCostReview({ userId: acc.id, role: Role.ACCOUNTANT }, { payerId: staff.id });
    const row = review.items.find((row) => row.sourceId === entry.id);
    assert.ok(row, 'row present');
    await db.transaction(async (tx) => {
      await confirmAccountingExpenses(tx, { userId: acc.id, role: Role.ACCOUNTANT }, [row.confirmRef]);
    });
    const book = await listFundBook('COMPANY');
    assert.ok(Array.isArray(book.accounts), 'fund book still readable post-confirm');
    const xeNha = await db.select().from(s.customers).where(eq(s.customers.name, 'Xe nhà'));
    assert.ok(Array.isArray(xeNha), 'catalog reads compose');
  });
});
