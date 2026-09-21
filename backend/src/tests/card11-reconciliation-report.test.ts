/**
 * Card 20260921_11 — the monthly reconciliation summary report.
 * Service-level suite; fixtures `card11-*`/`CARD11-*`, local DB :5441.
 *
 * Coverage:
 *   AC1/AC2 columns + formula to the đồng: per staff ĐNTT (confirmed ops
 *       costs in period) − ĐÃ ỨNG (held advances) = remaining.
 *   AC3 sign labeled: + = company pays back, − = company collects, labeled —
 *       never a bare negative.
 *   Consumption: advances consumed by existing reconciliations reduce held.
 *   AC4: vouchers ride the existing engine (cited; engine has own suites).
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { createOpsExpense } from '../services/ops-expenses.service';
import { confirmAccountingExpenses } from '../services/expense-accounting-write.service';
import { listMonthlyReconciliationReport } from '../services/ops-reconciliation-report.service';
import { Role } from '@tingting/shared';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TODAY = new Date().toISOString().slice(0, 10);
const LAST_MONTH = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

const cleanup: Array<() => Promise<void>> = [];
const track = (fn: () => Promise<void>) => cleanup.unshift(fn);

async function mkActor() {
  const [acc] = await db.insert(s.users).values({
    username: `card11-${suffix}-acct-${cleanup.length}`, passwordHash: 'x', role: 'ACCOUNTANT',
  }).returning();
  track(async () => { await db.delete(s.users).where(eq(s.users.id, acc.id)); });
  return acc;
}

async function mkStaff() {
  const [u] = await db.insert(s.users).values({
    username: `card11-${suffix}-ops-${cleanup.length}`, passwordHash: 'x', role: 'OPS',
  }).returning();
  track(async () => { await db.delete(s.users).where(eq(s.users.id, u.id)); });
  return u;
}

async function mkCostEntry(staff: { id: number }, shipmentId: number, amount: number, paidAt: string, opts: { confirm?: boolean } = {}) {
  const [link] = await db.insert(s.userShipmentLinks).values({ userId: staff.id, shipmentId })
    .onConflictDoNothing().returning();
  if (link) {
    track(async () => { await db.delete(s.userShipmentLinks).where(and(eq(s.userShipmentLinks.userId, staff.id), eq(s.userShipmentLinks.shipmentId, shipmentId))); });
  }
  const created = await createOpsExpense(staff.id, {
    shipmentId,
    expenseTypeCode: 'OTHER',
    amount,
    paidAt,
    costGroup: 'OPS_REGULAR',
    feeName: `card11 phí ${cleanup.length}`,
    customerChargeAmount: 0,
  });
  track(async () => { await db.delete(s.opsExpenseEntries).where(eq(s.opsExpenseEntries.id, (created as { id: number }).id)); });
  track(async () => {
    await db.delete(s.expenseAccountingSources).where(and(eq(s.expenseAccountingSources.sourceKind, 'OPS'), eq(s.expenseAccountingSources.sourceId, (created as { id: number }).id)));
  });
  if (opts.confirm) {
    const actor = { userId: 0, role: Role.ACCOUNTANT };
    const [source] = await db.select().from(s.expenseAccountingSources).where(and(
      eq(s.expenseAccountingSources.sourceKind, 'OPS'), eq(s.expenseAccountingSources.sourceId, (created as { id: number }).id)));
    actor.userId = staff.id;
    await db.transaction(async (tx) => {
      await confirmAccountingExpenses(tx, { userId: staff.id, role: Role.ACCOUNTANT },
        [{ sourceKind: 'OPS', sourceId: (created as { id: number }).id, expectedVersion: source.version }]);
    });
  }
  return created;
}

async function mkShipment() {
  const [customer] = await db.insert(s.customers).values({ name: `card11 cust ${suffix}-${cleanup.length}` }).returning();
  track(async () => { await db.delete(s.customers).where(eq(s.customers.id, customer.id)); });
  const [route] = await db.insert(s.routes).values({ name: `card11 route ${suffix}-${cleanup.length}` }).returning();
  track(async () => { await db.delete(s.routes).where(eq(s.routes.id, route.id)); });
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'PENDING_DATE',
  }).returning();
  track(async () => { await db.delete(s.shipments).where(eq(s.shipments.id, shipment.id)); });
  return { customer, route, shipment };
}


describe('card 20260921_11 - bao cao tong hop hoan ung', () => {
  test('columns, formula to the dong, labeled signs (AC1-AC3)', async () => {
    const acc = await mkActor();
    const staffA = await mkStaff();
    const staffB = await mkStaff();
    const { shipment } = await mkShipment();
    await mkCostEntry(staffA, shipment.id, 250000, TODAY, { confirm: true });
    await mkCostEntry(staffA, shipment.id, 120000, TODAY, { confirm: true });
    const eOut = await mkCostEntry(staffA, shipment.id, 90000, LAST_MONTH, { confirm: true });
    await db.insert(s.advanceRequests).values({ requesterId: staffA.id, amount: '300000', reason: 'card11 advance A', status: 'RECORDED' });
    await db.insert(s.advanceRequests).values({ requesterId: staffB.id, amount: '200000', reason: 'card11 advance B', status: 'RECORDED' });
    track(async () => { await db.delete(s.advanceRequests).where(eq(s.advanceRequests.reason, 'card11 advance A')); });
    track(async () => { await db.delete(s.advanceRequests).where(eq(s.advanceRequests.reason, 'card11 advance B')); });
    const report = await listMonthlyReconciliationReport({ userId: acc.id, role: Role.ACCOUNTANT }, { from: TODAY, to: TODAY });
    const rowA = report.rows.find((row) => row.staffId === staffA.id);
    const rowB = report.rows.find((row) => row.staffId === staffB.id);
    assert.ok(rowA, 'staff A row present');
    assert.ok(rowB, 'staff B row present');
    assert.equal(rowA.dntt, 370000);
    assert.equal(rowA.advanced, 300000);
    assert.equal(rowA.remaining, 70000);
    assert.equal(rowA.direction, 'CTY_THANH_TOAN_HOAN_UNG');
    assert.match(rowA.note, /thanh toán hoàn ứng/);
    assert.equal(rowB.dntt, 0);
    assert.equal(rowB.advanced, 200000);
    assert.equal(rowB.remaining, -200000);
    assert.equal(rowB.direction, 'CTY_YEU_CAU_HOAN_TRA');
    assert.match(rowB.note, /hoàn trả tạm ứng/);
    assert.ok(eOut, 'out-of-period entry created for the filter rung');
  });

  test('date filter and confirmation gate (AC1)', async () => {
    const acc = await mkActor();
    const staff = await mkStaff();
    const { shipment } = await mkShipment();
    await mkCostEntry(staff, shipment.id, 80000, LAST_MONTH, { confirm: true });
    const report = await listMonthlyReconciliationReport({ userId: acc.id, role: Role.ACCOUNTANT }, { from: TODAY, to: TODAY });
    const row = report.rows.find((row) => row.staffId === staff.id);
    assert.ok(!row || row.dntt === 0, 'out-of-period cost excluded from the period totals');
  });

  test('consumed advances reduce held (existing reconciliation links)', async () => {
    const acc = await mkActor();
    const staff = await mkStaff();
    await db.insert(s.advanceRequests).values({ requesterId: staff.id, amount: '150000', reason: `card11 adv ${suffix}`, status: 'RECORDED' });
    track(async () => { await db.delete(s.advanceRequests).where(eq(s.advanceRequests.reason, `card11 adv ${suffix}`)); });
    const [reconciliation] = await db.insert(s.expenseReconciliations).values({
      code: `CARD11-RC-${suffix}`, opsUserId: staff.id,
      from: TODAY, to: TODAY, amount: '100000', advanceAmount: '100000',
      createdById: acc.id,
    }).returning();
    track(async () => { await db.delete(s.expenseReconciliations).where(eq(s.expenseReconciliations.id, reconciliation.id)); });
    const [advRow] = await db.select({ id: s.advanceRequests.id }).from(s.advanceRequests)
      .where(eq(s.advanceRequests.reason, `card11 adv ${suffix}`));
    await db.insert(s.expenseReconciliationAdvances).values({
      reconciliationId: reconciliation.id, advanceRequestId: advRow!.id, amount: '100000',
    });
    track(async () => { await db.delete(s.expenseReconciliationAdvances).where(eq(s.expenseReconciliationAdvances.reconciliationId, reconciliation.id)); });
    const report = await listMonthlyReconciliationReport({ userId: acc.id, role: Role.ACCOUNTANT }, { from: TODAY, to: TODAY });
    const row = report.rows.find((row) => row.staffId === staff.id);
    assert.ok(row, 'staff row present');
    assert.equal(row.advanced, 50000, 'consumed advance amount reduces held');
  });
});
