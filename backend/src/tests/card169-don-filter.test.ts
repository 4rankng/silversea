/**
 * Card 20260928_169 — the "đợt làm đề nghị" filter on the reimbursement report.
 *
 * A "đợt" is an `expense_reconciliations` lot. Per the PRD (OpsVanHanh §9.2) it
 * OWNS a set of costs, ALLOCATES received advances to them, and never lets one
 * item land in two batches. A lot owns exactly the cost rows it stamped
 * (`expense_accounting_sources.reconciliation_id` — what createExpenseReconciliation
 * writes on every entry) and allocates advances through
 * `expense_reconciliation_advances`.
 *
 * These tests pin that ownership rule: selecting a đợt narrows the report to
 * exactly that lot, and charges it only the advances the lot actually
 * allocated — not the whole balance the staff happens to hold.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { createOpsExpense } from '../services/ops-expenses.service';
import { confirmAccountingExpenses } from '../services/expense-accounting-write.service';
import { listMonthlyReconciliationReport } from '../services/ops-reconciliation-report.service';
import { ApiError } from '../errors';
import { Role, TxnType } from '@tingting/shared';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TODAY = new Date().toISOString().slice(0, 10);
const MONTH_START = `${TODAY.slice(0, 7)}-01`;

const cleanup: Array<() => Promise<void>> = [];
const track = (fn: () => Promise<void>) => cleanup.unshift(fn);

async function mkActor() {
  const [acc] = await db.insert(s.users).values({
    username: `card169-${suffix}-acct-${cleanup.length}`, passwordHash: 'x', role: 'ACCOUNTANT',
  }).returning();
  track(async () => { await db.delete(s.users).where(eq(s.users.id, acc.id)); });
  return acc;
}

async function mkStaff() {
  const [u] = await db.insert(s.users).values({
    username: `card169-${suffix}-ops-${cleanup.length}`, passwordHash: 'x', role: 'OPS',
  }).returning();
  track(async () => { await db.delete(s.users).where(eq(s.users.id, u.id)); });
  return u;
}

async function mkShipment() {
  const [customer] = await db.insert(s.customers).values({ name: `card169 cust ${suffix}-${cleanup.length}` }).returning();
  track(async () => { await db.delete(s.customers).where(eq(s.customers.id, customer.id)); });
  const [route] = await db.insert(s.routes).values({ name: `card169 route ${suffix}-${cleanup.length}` }).returning();
  track(async () => { await db.delete(s.routes).where(eq(s.routes.id, route.id)); });
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'PENDING_DATE',
  }).returning();
  track(async () => { await db.delete(s.shipments).where(eq(s.shipments.id, shipment.id)); });
  return shipment;
}

async function mkConfirmedCost(staff: { id: number }, shipmentId: number, amount: number, paidAt: string) {
  await db.insert(s.userShipmentLinks).values({ userId: staff.id, shipmentId }).onConflictDoNothing();
  const created = await createOpsExpense(staff.id, {
    shipmentId,
    expenseTypeCode: 'OTHER',
    amount,
    paidAt,
    costGroup: 'OPS_REGULAR',
    feeName: `card169 phí ${cleanup.length}`,
    customerChargeAmount: 0,
    // A non-charged cost line must carry a reason (the card-162 guard).
    note: `card169 không thu khách ${cleanup.length}`,
  });
  const id = (created as { id: number }).id;
  track(async () => { await db.delete(s.opsExpenseEntries).where(eq(s.opsExpenseEntries.id, id)); });
  track(async () => {
    await db.delete(s.expenseAccountingSources).where(and(
      eq(s.expenseAccountingSources.sourceKind, 'OPS'), eq(s.expenseAccountingSources.sourceId, id)));
  });
  const [source] = await db.select().from(s.expenseAccountingSources).where(and(
    eq(s.expenseAccountingSources.sourceKind, 'OPS'), eq(s.expenseAccountingSources.sourceId, id)));
  await db.transaction(async (tx) => {
    await confirmAccountingExpenses(tx, { userId: staff.id, role: Role.ACCOUNTANT },
      [{ sourceKind: 'OPS', sourceId: id, expectedVersion: source.version }]);
  });
  return id;
}

/** Stamp a cost into a lot — the write the real engine (createExpenseReconciliation)
 *  performs for every entry a đợt claims. Lots own stamped rows only, so a
 *  fixture that claims a cost without stamping it describes a lot the engine
 *  cannot produce. */
async function ownCost(lotId: number, entryId: number, allocatedAdvance: number) {
  await db.update(s.expenseAccountingSources)
    .set({ reconciliationId: lotId, allocatedAdvanceAmount: String(allocatedAdvance) })
    .where(and(eq(s.expenseAccountingSources.sourceKind, 'OPS'), eq(s.expenseAccountingSources.sourceId, entryId)));
}

async function mkAdvance(staff: { id: number }, amount: number, reason: string, funded = false) {
  const [adv] = await db.insert(s.advanceRequests)
    .values({ requesterId: staff.id, amount: String(amount), reason, status: 'RECORDED' })
    .returning();
  track(async () => { await db.delete(s.advanceRequests).where(eq(s.advanceRequests.id, adv.id)); });
  if (funded) {
    // The 2026-09-29 PM ruling (card 168 "RULING PM" câu 1): a RECORDED
    // request without money is not an advance — "Còn phải hoàn ứng" counts
    // only what was actually granted. Write the same funding pair the real
    // engine posts (OPS_ADVANCE ledger + treasury OUT movement) so the
    // canonical outstanding reads this fixture.
    const [account] = await db.insert(s.treasuryAccounts).values({
      code: `CARD169-${suffix}-fund-${adv.id}`, name: `card169 fund ${suffix}-${adv.id}`,
      type: 'CASH', fundCode: 'COMPANY', status: 'ACTIVE', openingBalance: '0',
      createdBy: 1, updatedBy: 1,
    }).returning();
    track(async () => { await db.delete(s.treasuryAccounts).where(eq(s.treasuryAccounts.id, account.id)); });
    const [ledger] = await db.insert(s.ledger).values({
      txnType: TxnType.OPS_ADVANCE, txnId: adv.id, entityType: 'FORWARDER', entityId: staff.id,
      debit: '0', credit: String(amount), balance: String(amount), note: `card169 funded ${suffix}`,
    }).returning();
    track(async () => { await db.delete(s.ledger).where(eq(s.ledger.id, ledger.id)); });
    const [movement] = await db.insert(s.treasuryMovements).values({
      treasuryAccountId: account.id, direction: 'OUT', amount: String(amount),
      valueDate: TODAY, status: 'POSTED', ledgerEntryId: ledger.id, sourceVersion: 1,
      paymentContractVersion: 2, createdBy: 1, physicalReference: `card169-${suffix}-fund-${adv.id}`,
    }).returning();
    track(async () => { await db.delete(s.treasuryMovements).where(eq(s.treasuryMovements.id, movement.id)); });
  }
  return adv;
}

async function mkLot(opsUserId: number, from: string, to: string, note: string, createdById: number) {
  const [lot] = await db.insert(s.expenseReconciliations).values({
    code: `CARD169-${suffix}-${note}`, opsUserId, from, to,
    amount: '0', advanceAmount: '0', createdById,
  }).returning();
  track(async () => { await db.delete(s.expenseReconciliations).where(eq(s.expenseReconciliations.id, lot.id)); });
  return lot;
}

async function allocate(lotId: number, advanceId: number, amount: number) {
  const [row] = await db.insert(s.expenseReconciliationAdvances)
    .values({ reconciliationId: lotId, advanceRequestId: advanceId, amount: String(amount) })
    .returning();
  track(async () => { await db.delete(s.expenseReconciliationAdvances).where(eq(s.expenseReconciliationAdvances.id, row.id)); });
}

describe('card 20260928_169 — bộ lọc "đợt làm đề nghị"', () => {
  test('a đợt narrows the report to its own staff and window', async () => {
    const acc = await mkActor();
    const staffA = await mkStaff();
    const staffB = await mkStaff();
    const shipment = await mkShipment();

    const costA = await mkConfirmedCost(staffA, shipment.id, 100000, TODAY);
    await mkConfirmedCost(staffB, shipment.id, 900000, TODAY);

    const lot = await mkLot(staffA.id, MONTH_START, TODAY, 'A', acc.id);
    await ownCost(lot.id, costA, 0);
    const report = await listMonthlyReconciliationReport(
      { userId: acc.id, role: Role.ACCOUNTANT }, { reconciliationId: lot.id });

    assert.equal(report.reconciliation?.id, lot.id);
    assert.equal(report.reconciliation?.code, lot.code);
    // The lot DEFINES the window, so the response reports the lot's own.
    assert.equal(report.from, MONTH_START);
    assert.equal(report.to, TODAY);
    // Staff B's cost is not in this batch and must not appear.
    assert.equal(report.rows.filter((row) => row.staffId === staffB.id).length, 0);
    const rowA = report.rows.find((row) => row.staffId === staffA.id);
    assert.ok(rowA, 'the lot owner has a row');
    assert.equal(rowA.dntt, 100000);
    assert.equal(report.totals.dntt, 100000);
  });

  test('a đợt is charged only the advances IT allocated; remaining is the sổ quỹ number', async () => {
    const acc = await mkActor();
    const staffA = await mkStaff();
    const shipment = await mkShipment();
    const cost = await mkConfirmedCost(staffA, shipment.id, 500000, TODAY);

    // The staff was granted 800k, but this lot only allocated 250k of it.
    const advance = await mkAdvance(staffA, 800000, `card169 adv ${suffix}`, true);
    const lot = await mkLot(staffA.id, MONTH_START, TODAY, 'B', acc.id);
    await allocate(lot.id, advance.id, 250000);
    await ownCost(lot.id, cost, 250000);

    const scoped = await listMonthlyReconciliationReport(
      { userId: acc.id, role: Role.ACCOUNTANT }, { reconciliationId: lot.id });
    const rowA = scoped.rows.find((row) => row.staffId === staffA.id);
    assert.ok(rowA);
    assert.equal(rowA.advanced, 250000, 'only the lot allocation counts');
    // Card 168 PM ruling (2026-09-29): "Còn phải hoàn ứng" is the sổ quỹ
    // closing formula min(đã ứng, đã cấp) − đã tiêu — the granted-but-unconsumed
    // advance (800k granted − 250k consumed by this lot), NOT ĐNTT − ĐÃ ỨNG.
    assert.equal(rowA.remaining, 550000);
    assert.equal(rowA.direction, 'CTY_YEU_CAU_HOAN_TRA');

    // Unscoped, the same staff shows what they STILL HOLD — the held balance
    // minus what reconciliations already consumed (800k − 250k = 550k). That is
    // the pre-existing semantic, and it differs from the 250k the lot allocated,
    // which is what proves the filter actually changes the number.
    const unscoped = await listMonthlyReconciliationReport(
      { userId: acc.id, role: Role.ACCOUNTANT }, { from: TODAY, to: TODAY });
    const unscopedRow = unscoped.rows.find((row) => row.staffId === staffA.id);
    assert.ok(unscopedRow);
    assert.equal(unscopedRow.advanced, 550000);
    assert.notEqual(unscopedRow.advanced, rowA.advanced);
    // One definition: scoped and unscoped remaining are the same book number.
    assert.equal(unscopedRow.remaining, rowA.remaining);
    // The scoped call names its lot; the unscoped one does not.
    assert.equal(scoped.reconciliation?.id, lot.id);
    assert.equal(unscoped.reconciliation, undefined);
  });

  test('an unknown đợt is 404 and a voided one is refused', async () => {
    const acc = await mkActor();
    const staffA = await mkStaff();
    await assert.rejects(
      () => listMonthlyReconciliationReport({ userId: acc.id, role: Role.ACCOUNTANT }, { reconciliationId: 999_999_999 }),
      (error: unknown) => error instanceof ApiError && error.statusCode === 404);

    const lot = await mkLot(staffA.id, MONTH_START, TODAY, 'C', acc.id);
    await db.update(s.expenseReconciliations)
      .set({ voidedAt: new Date() })
      .where(eq(s.expenseReconciliations.id, lot.id));
    await assert.rejects(
      () => listMonthlyReconciliationReport({ userId: acc.id, role: Role.ACCOUNTANT }, { reconciliationId: lot.id }),
      (error: unknown) => error instanceof ApiError && error.statusCode === 400);
  });
});
