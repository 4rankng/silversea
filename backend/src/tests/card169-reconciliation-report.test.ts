/**
 * Card 20260928_169 — the "đợt làm đề nghị" axis of the reimbursement report.
 * Service-level suite; fixtures prefix `card169-`/`CARD169-`, isolation runner
 * (throwaway DB), sibling of card11-reconciliation-report.test.ts.
 *
 * Coverage (rulings: docs/adr/2026-09-28-kanban-pm-open-questions-rulings.md
 * "Card 169", superseded on the remaining formula by the 2026-09-29 PM ruling
 * in the card-168 board block "RULING PM" câu 1; docs/prd/OpsVanHanh.md §9.2):
 *   AC1 — the đợt filter returns only that lot's costs and allocated advances;
 *         a same-window cost of the same staff that the lot does NOT own never
 *         leaks in ("một khoản chi không được tính toàn bộ vào nhiều đợt");
 *         the employee axis narrows the monthly view; a voided lot refuses.
 *   AC2/AC5 — criterion 5 as superseded (2026-09-29): "Còn phải hoàn ứng" IS
 *         the sổ quỹ closing number — min(đã ứng, đã cấp) − đã tiêu, the
 *         canonical advance outstanding — so report.remaining === the fund
 *         book's OPS number on the same staff, EXACT equality, no sign
 *         inversion, before and after the phiếu posts. ĐNTT and ĐÃ ỨNG stay
 *         displayed; the phiếu direction still rides the đợt's own difference.
 *   AC3 — the engine refuses the wrong direction on both sides: an OUT voucher
 *         on an over-advanced lot, an IN refund on a lot the company owes, and
 *         a second CHI after the obligation was already settled once.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { createOpsExpense } from '../services/ops-expenses.service';
import { confirmAccountingExpenses } from '../services/expense-accounting-write.service';
import { listMonthlyReconciliationReport } from '../services/ops-reconciliation-report.service';
import { createExpenseReconciliation, recordFundedOpsAdvance, refundExpenseReconciliation } from '../services/expense-accounting-reconciliation.service';
import { createExpenseVoucher } from '../services/expense-accounting-voucher.service';
import type { ExpenseActor } from '../services/expense-accounting-write.service';
import { listFundBook } from '../services/treasury-fund-book.service';
import { getOutstandingAdvanceBalances } from '../services/advance-shared.service';
import { Role, TxnType } from '@tingting/shared';
import { ApiError } from '../errors';
import { disconnectRedis } from '../lib/redis';
import { invalidateReportCaches } from '../lib/report-cache';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TODAY = new Date().toISOString().slice(0, 10);

const cleanup: Array<() => Promise<void>> = [];
const track = (fn: () => Promise<void>) => cleanup.unshift(fn);
const refCounter = { value: 0 };
const nextRef = () => `card169-${suffix}-${++refCounter.value}`;

async function expectApiError(promise: Promise<unknown>, status: number, messagePart: string) {
  await promise.then(
    () => { throw new Error(`expected ApiError ${status} (${messagePart}), got success`); },
    (err: unknown) => {
      assert.ok(err instanceof ApiError, `expected ApiError, got ${(err as Error).name}: ${(err as Error).message}`);
      assert.equal(err.statusCode, status);
      assert.match(err.message, new RegExp(messagePart));
    },
  );
}

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

async function mkAccount() {
  // A dedicated COMPANY-fund account per movement source so the fund-book
  // assertion reads exactly the phiếu this test posts — never seeded noise.
  const [account] = await db.insert(s.treasuryAccounts).values({
    code: `CARD169-${suffix}-${cleanup.length}`,
    name: `card169 acct ${suffix}-${cleanup.length}`,
    type: 'CASH',
    fundCode: 'COMPANY',
    status: 'ACTIVE',
    openingBalance: '0',
    createdBy: 1,
    updatedBy: 1,
  }).returning();
  track(async () => { await db.delete(s.treasuryAccounts).where(eq(s.treasuryAccounts.id, account.id)); });
  return account;
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

/** A confirmed ops cost the staff paid personally (payable FORWARDER → the
 *  staff), exactly the rows a đợt may own. */
async function mkCostEntry(staff: { id: number }, shipmentId: number, amount: number) {
  const [link] = await db.insert(s.userShipmentLinks).values({ userId: staff.id, shipmentId })
    .onConflictDoNothing().returning();
  if (link) {
    track(async () => { await db.delete(s.userShipmentLinks).where(and(eq(s.userShipmentLinks.userId, staff.id), eq(s.userShipmentLinks.shipmentId, shipmentId))); });
  }
  const created = await createOpsExpense(staff.id, {
    shipmentId,
    expenseTypeCode: 'OTHER',
    amount,
    paidAt: TODAY,
    costGroup: 'OPS_REGULAR',
    feeName: `card169 phí ${cleanup.length}`,
    customerChargeAmount: 0,
    note: `card169 không thu khách ${cleanup.length}`,
  });
  const entryId = (created as { id: number }).id;
  track(async () => { await db.delete(s.opsExpenseEntries).where(eq(s.opsExpenseEntries.id, entryId)); });
  track(async () => {
    await db.delete(s.expenseAccountingSources).where(and(eq(s.expenseAccountingSources.sourceKind, 'OPS'), eq(s.expenseAccountingSources.sourceId, entryId)));
  });
  const [source] = await db.select().from(s.expenseAccountingSources).where(and(
    eq(s.expenseAccountingSources.sourceKind, 'OPS'), eq(s.expenseAccountingSources.sourceId, entryId)));
  await db.transaction(async (tx) => {
    await confirmAccountingExpenses(tx, { userId: staff.id, role: Role.ACCOUNTANT },
      [{ sourceKind: 'OPS', sourceId: entryId, expectedVersion: source.version }]);
  });
  return entryId;
}

/** The current source version — the reconciliation and the voucher engine each
 *  bump it, so every command must read it fresh. */
async function sourceVersion(entryId: number) {
  const [source] = await db.select({ version: s.expenseAccountingSources.version }).from(s.expenseAccountingSources)
    .where(and(eq(s.expenseAccountingSources.sourceKind, 'OPS'), eq(s.expenseAccountingSources.sourceId, entryId)));
  return source.version;
}

/** Fund an advance through the real engine (ledger + treasury OUT movement) on
 *  the given account, and register the full cleanup chain. */
async function mkFundedAdvance(actor: ExpenseActor, staff: { id: number }, amount: number, account: { id: number }) {
  const reference = nextRef();
  const advance = await db.transaction(async (tx) => recordFundedOpsAdvance(tx, actor, {
    opsUserId: staff.id, amount, reason: `card169 advance ${suffix}`, treasuryAccountId: account.id,
    valueDate: TODAY, physicalReference: reference,
  }));
  track(async () => { await db.delete(s.advanceRequests).where(eq(s.advanceRequests.id, advance.id)); });
  track(async () => {
    await db.delete(s.ledger).where(and(eq(s.ledger.txnType, TxnType.OPS_ADVANCE), eq(s.ledger.txnId, advance.id)));
    const [movement] = await db.select().from(s.treasuryMovements).where(eq(s.treasuryMovements.physicalReference, reference));
    if (movement) {
      if (movement.ledgerEntryId) await db.delete(s.ledger).where(eq(s.ledger.id, movement.ledgerEntryId));
      await db.delete(s.treasuryMovements).where(eq(s.treasuryMovements.id, movement.id));
    }
  });
  return advance;
}

/** Build a đợt (reconciliation lot) through the real engine. */
async function mkLot(actor: ExpenseActor, staff: { id: number }, entryIds: number[], advances: Array<{ advanceRequestId: number; amount: number }>) {
  const entries: Array<{ sourceKind: 'OPS'; sourceId: number; expectedVersion: number }> = [];
  for (const sourceId of entryIds) {
    entries.push({ sourceKind: 'OPS' as const, sourceId, expectedVersion: await sourceVersion(sourceId) });
  }
  const lot = await db.transaction(async (tx) => createExpenseReconciliation(tx, actor, {
    opsUserId: staff.id, from: TODAY, to: TODAY,
    entries,
    advances,
    note: `card169 lot ${suffix}`,
  }));
  track(async () => { await db.delete(s.expenseReconciliationAdvances).where(eq(s.expenseReconciliationAdvances.reconciliationId, lot.id)); });
  track(async () => { await db.delete(s.expenseReconciliations).where(eq(s.expenseReconciliations.id, lot.id)); });
  return lot;
}

/** Post a phiếu and register its cleanup chain (allocations → voucher →
 *  movement → ledger), so the throwaway DB stays coherent even mid-suite. */
async function postChiVoucher(actor: ExpenseActor, entryId: number, amount: number, account: { id: number }) {
  const reference = nextRef();
  const version = await sourceVersion(entryId);
  const voucher = await db.transaction(async (tx) => createExpenseVoucher(tx, actor, {
    direction: 'OUT', treasuryAccountId: account.id, valueDate: TODAY, physicalReference: reference,
    note: `card169 chi ${suffix}`,
    entries: [{ sourceKind: 'OPS', sourceId: entryId, expectedVersion: version, amount }],
  }));
  track(async () => {
    await db.delete(s.expenseCashAllocations).where(eq(s.expenseCashAllocations.voucherId, voucher.id));
    await db.delete(s.expenseCashVouchers).where(eq(s.expenseCashVouchers.id, voucher.id));
    const [movement] = await db.select().from(s.treasuryMovements).where(eq(s.treasuryMovements.physicalReference, reference));
    if (movement) {
      if (movement.ledgerEntryId) await db.delete(s.ledger).where(eq(s.ledger.id, movement.ledgerEntryId));
      await db.delete(s.treasuryMovements).where(eq(s.treasuryMovements.id, movement.id));
    }
  });
  return voucher;
}

async function bookBalanceOf(accountId: number) {
  const book = await listFundBook('COMPANY');
  const row = book.accounts.find((account) => account.accountId === accountId);
  assert.ok(row, 'fixture account must sit in the COMPANY fund book');
  return row.bookBalance;
}

describe('card 20260928_169 - bao cao tong hop hoan ung theo dot', () => {
  test('dot filter owns exactly its costs and allocated advances (AC1)', async () => {
    const actorRow = await mkActor();
    const finance: ExpenseActor = { userId: actorRow.id, role: Role.ACCOUNTANT };
    const staff = await mkStaff();
    const other = await mkStaff();
    const shipment = await mkShipment();
    const inLot = await mkCostEntry(staff, shipment.id, 250000);
    await mkCostEntry(staff, shipment.id, 120000); // same staff, same window — NOT in the lot
    const funding = await mkAccount();
    const advance = await mkFundedAdvance(finance, staff, 300000, funding);
    const lot = await mkLot(finance, staff, [inLot], [{ advanceRequestId: advance.id, amount: 100000 }]);

    const scoped = await listMonthlyReconciliationReport(finance, { reconciliationId: lot.id });
    assert.ok(scoped.reconciliation, 'the response carries the scoped lot');
    assert.equal(scoped.reconciliation!.id, lot.id);
    assert.equal(scoped.reconciliation!.code, lot.code);
    assert.equal(scoped.from, TODAY, 'the lot defines the window');
    const row = scoped.rows.find((r) => r.staffId === staff.id);
    assert.ok(row, 'scoped row present');
    assert.equal(row.dntt, 250000, 'ĐNTT counts only the costs the lot owns');
    assert.equal(row.advanced, 100000, 'ĐÃ ỨNG counts only what the lot allocated');
    // 2026-09-29 ruling: remaining is the sổ quỹ closing number — granted
    // 300.000 minus consumed 100.000 — not ĐNTT − ĐÃ ỨNG.
    assert.equal(row.remaining, 200000);
    assert.equal(row.direction, 'CTY_YEU_CAU_HOAN_TRA');
    assert.equal(scoped.totals.remaining, 200000);

    // Unscoped monthly view: both confirmed costs of the window count, and the
    // held advance is the funded amount minus what the lot consumed.
    const monthly = await listMonthlyReconciliationReport(finance, { from: TODAY, to: TODAY });
    const monthlyRow = monthly.rows.find((r) => r.staffId === staff.id);
    assert.ok(monthlyRow, 'monthly row present');
    assert.equal(monthlyRow.dntt, 370000, 'the monthly view counts both costs — ownership only narrows the đợt view');
    assert.equal(monthlyRow.advanced, 200000, 'held = funded 300000 − consumed 100000');
    assert.equal(monthlyRow.remaining, 200000, 'one definition: the book number is the same in both modes');

    // Employee axis: narrows the monthly view to one person.
    const oneStaff = await listMonthlyReconciliationReport(finance, { from: TODAY, to: TODAY, opsUserId: staff.id });
    assert.ok(oneStaff.rows.every((r) => r.staffId === staff.id), 'employee filter leaves only that staff');
    assert.equal(oneStaff.totals.dntt, monthlyRow.dntt);
    const emptyStaff = await listMonthlyReconciliationReport(finance, { from: TODAY, to: TODAY, opsUserId: other.id });
    assert.equal(emptyStaff.rows.length, 0);
    assert.equal(emptyStaff.totals.remaining, 0);

    // The employee filter must agree with the lot's own staff.
    await expectApiError(
      listMonthlyReconciliationReport(finance, { reconciliationId: lot.id, opsUserId: other.id }),
      400, 'nhân viên khác');

    // A voided lot never reports.
    await db.update(s.expenseReconciliations).set({ voidedAt: new Date() }).where(eq(s.expenseReconciliations.id, lot.id));
    await expectApiError(
      listMonthlyReconciliationReport(finance, { reconciliationId: lot.id }),
      400, 'đã bị hủy');
    await db.update(s.expenseReconciliations).set({ voidedAt: null }).where(eq(s.expenseReconciliations.id, lot.id));
  });

  test('criterion 5 — remaining IS the sổ quỹ number, exact, before and after the phiếu CHI (AC2/AC4/AC5)', async () => {
    const actorRow = await mkActor();
    const finance: ExpenseActor = { userId: actorRow.id, role: Role.ACCOUNTANT };
    const staff = await mkStaff();
    const shipment = await mkShipment();
    const entry = await mkCostEntry(staff, shipment.id, 1200000);
    const funding = await mkAccount();
    const advance = await mkFundedAdvance(finance, staff, 1000000, funding);
    const lot = await mkLot(finance, staff, [entry], [{ advanceRequestId: advance.id, amount: 1000000 }]);
    const reimbursementAccount = await mkAccount(); // opening 0, nothing else moves here

    // The lot consumed the whole grant, so the book outstanding is 0 even though
    // the company still owes 200k of costs (that difference lives on the đợt and
    // drives the phiếu CHI — asserted below).
    const before = await listMonthlyReconciliationReport(finance, { reconciliationId: lot.id });
    const beforeRow = before.rows.find((r) => r.staffId === staff.id);
    assert.ok(beforeRow);
    assert.equal(beforeRow.dntt, 1200000);
    assert.equal(beforeRow.advanced, 1000000);
    assert.equal(beforeRow.remaining, 0);
    const canonicalBefore = (await getOutstandingAdvanceBalances(staff.id)).totalOutstanding;
    assert.equal(beforeRow.remaining, canonicalBefore, 'report.remaining === the canonical sổ quỹ number, same sign, exact');

    // Wrong direction FIRST (AC3): the company OWES the staff on this lot, so
    // the THU refund must refuse — the đợt only "còn phải hoàn" what the staff owes.
    await expectApiError(db.transaction(async (tx) => refundExpenseReconciliation(tx, finance, lot.id, {
      treasuryAccountId: reimbursementAccount.id, valueDate: TODAY, physicalReference: nextRef(),
      amount: 1, reason: 'card169 wrong-direction THU',
    })), 409, 'chỉ còn phải hoàn 0');

    // The phiếu CHI posts through the existing engine: per-source remainder is
    // the cost minus the advance allocated to it.
    await postChiVoucher(finance, entry, 200000, reimbursementAccount);
    assert.equal(await bookBalanceOf(reimbursementAccount.id), -200000, 'the phiếu CHI moved the fund account');

    const after = await listMonthlyReconciliationReport(finance, { reconciliationId: lot.id });
    const afterRow = after.rows.find((r) => r.staffId === staff.id);
    assert.ok(afterRow);
    const canonicalAfter = (await getOutstandingAdvanceBalances(staff.id)).totalOutstanding;
    assert.equal(afterRow.remaining, canonicalAfter, 'same definition after the phiếu posts — the tables cannot diverge');
    assert.equal(afterRow.remaining, 0);

    // The cost-side obligation settles exactly once: a second CHI finds nothing left.
    await expectApiError(postChiVoucher(finance, entry, 1, reimbursementAccount), 409, 'chỉ còn 0');
  });

  test('THU side — the phiếu thu settles the đợt exactly once; wrong-direction CHI refuses (AC2/AC3)', async () => {
    const actorRow = await mkActor();
    const finance: ExpenseActor = { userId: actorRow.id, role: Role.ACCOUNTANT };
    const staff = await mkStaff();
    const shipment = await mkShipment();
    const entry = await mkCostEntry(staff, shipment.id, 800000);
    const funding = await mkAccount();
    const advance = await mkFundedAdvance(finance, staff, 1000000, funding);
    const lot = await mkLot(finance, staff, [entry], [{ advanceRequestId: advance.id, amount: 1000000 }]);
    const collectionAccount = await mkAccount(); // opening 0, nothing else moves here

    const report = await listMonthlyReconciliationReport(finance, { reconciliationId: lot.id });
    const row = report.rows.find((r) => r.staffId === staff.id);
    assert.ok(row);
    assert.equal(row.remaining, (await getOutstandingAdvanceBalances(staff.id)).totalOutstanding, 'remaining IS the book number');
    assert.equal(row.remaining, 0, 'the whole grant is consumed by the lot; the 200k the staff owes lives on the đợt');

    // Wrong direction (AC3): the advance over-covers the costs, so every source
    // has nothing left to pay — an OUT voucher cannot be built.
    await expectApiError(db.transaction(async (tx) => createExpenseVoucher(tx, finance, {
      direction: 'OUT', treasuryAccountId: collectionAccount.id, valueDate: TODAY, physicalReference: nextRef(),
      entries: [{ sourceKind: 'OPS', sourceId: entry, expectedVersion: await sourceVersion(entry), amount: 1 }],
    })), 409, 'chỉ còn 0');

    // The phiếu THU posts through the existing engine (reconciliation refund).
    const refundReference = nextRef();
    const refundVoucher = await db.transaction(async (tx) => refundExpenseReconciliation(tx, finance, lot.id, {
      treasuryAccountId: collectionAccount.id, valueDate: TODAY, physicalReference: refundReference,
      amount: 200000, reason: 'card169 thu hoan ung',
    }));
    track(async () => {
      await db.delete(s.expenseCashVouchers).where(eq(s.expenseCashVouchers.id, refundVoucher.id));
      const [movement] = await db.select().from(s.treasuryMovements).where(eq(s.treasuryMovements.physicalReference, refundReference));
      if (movement) {
        if (movement.ledgerEntryId) await db.delete(s.ledger).where(eq(s.ledger.id, movement.ledgerEntryId));
        await db.delete(s.treasuryMovements).where(eq(s.treasuryMovements.id, movement.id));
      }
    });
    assert.equal(await bookBalanceOf(collectionAccount.id), 200000, 'the phiếu THU moved the fund account');

    // The staff's obligation settles exactly once: the refund cap is gone.
    await expectApiError(db.transaction(async (tx) => refundExpenseReconciliation(tx, finance, lot.id, {
      treasuryAccountId: collectionAccount.id, valueDate: TODAY, physicalReference: nextRef(),
      amount: 1, reason: 'card169 double THU',
    })), 409, 'chỉ còn phải hoàn 0');
  });
});

after(async () => {
  for (const fn of cleanup) {
    try { await fn(); } catch (err) { console.warn('[card169] cleanup:', (err as Error).message); }
  }
  try { await invalidateReportCaches(); } catch { /* non-critical */ }
  try { await disconnectRedis(); } catch { /* already-closed is fine */ }
  try { await client.end({ timeout: 1 }); } catch { /* ignore */ }
});
