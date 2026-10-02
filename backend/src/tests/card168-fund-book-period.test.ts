/**
 * Card 20260928_168 AC3 — the Sổ quỹ period filter + the cross-table
 * convergence with the 169 report, asserted by test, never by eye.
 *
 * Rulings (card 168 board block "[2026-09-29] RULING PM", câu 1 + câu 2):
 *   câu 1 — "Còn phải hoàn ứng" takes the SỔ QUỸ closing formula as the one
 *           standard: min(đã ứng, đã cấp) − đã tiêu (the canonical advance
 *           outstanding). The 169 report already reads it; the fund book's
 *           TÀI KHOẢN OPS section must read the SAME authority, so the two
 *           tables are one definition and cannot diverge.
 *   câu 2 — the Sổ quỹ accepts a from/to period and carries the opening
 *           balance (số dư đầu kỳ lũy kế đến 'from').
 * PRD OpsVanHanh §9.2: "hoàn ứng thực tế giảm nghĩa vụ còn lại đúng một lần"
 * and "sau khi phiếu post, sổ quỹ và báo cáo hội tụ về một số" — pinned here
 * by reading BOTH numbers again after the phiếu THU hoàn ứng posts.
 *
 * Service-level suite; fixtures prefix `card168-`/`CARD168-`, isolation runner
 * (throwaway DB), sibling of card169-reconciliation-report.test.ts.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { createOpsExpense } from '../services/ops-expenses.service';
import { confirmAccountingExpenses, type ExpenseActor } from '../services/expense-accounting-write.service';
import { listMonthlyReconciliationReport } from '../services/ops-reconciliation-report.service';
import { createExpenseReconciliation, recordFundedOpsAdvance, refundExpenseReconciliation } from '../services/expense-accounting-reconciliation.service';
import { listFundBook } from '../services/treasury-fund-book.service';
import { Role, TxnType } from '@tingting/shared';
import { ApiError } from '../errors';
import { disconnectRedis } from '../lib/redis';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TODAY = new Date().toISOString().slice(0, 10);
const YESTERDAY = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const cleanup: Array<() => Promise<void>> = [];
const track = (fn: () => Promise<void>) => cleanup.unshift(fn);
const refCounter = { value: 0 };
const nextRef = () => `card168-${suffix}-${++refCounter.value}`;

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
    username: `card168-${suffix}-acct-${cleanup.length}`, passwordHash: 'x', role: 'ACCOUNTANT',
  }).returning();
  track(async () => { await db.delete(s.users).where(eq(s.users.id, acc.id)); });
  return acc;
}

async function mkStaff() {
  const [u] = await db.insert(s.users).values({
    username: `card168-${suffix}-ops-${cleanup.length}`, passwordHash: 'x', role: 'OPS',
  }).returning();
  track(async () => { await db.delete(s.users).where(eq(s.users.id, u.id)); });
  return u;
}

async function mkAccount() {
  // A dedicated COMPANY-fund account so the fund-book rows read exactly this
  // fixture's movements — never seeded noise.
  const [account] = await db.insert(s.treasuryAccounts).values({
    code: `CARD168-${suffix}-${cleanup.length}`,
    name: `card168 acct ${suffix}-${cleanup.length}`,
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

/** A POSTED treasury movement written directly (append-only table), dated
 * explicitly so the carried-opening half of the period filter has a past. */
async function mkMovement(accountId: number, direction: 'IN' | 'OUT', amount: string, valueDate: string) {
  const [movement] = await db.insert(s.treasuryMovements).values({
    treasuryAccountId: accountId,
    direction,
    amount,
    valueDate,
    status: 'POSTED',
    sourceVersion: 1,
    createdBy: 1,
    physicalReference: `card168-ref-${suffix}-${cleanup.length}`,
    paymentContractVersion: 1,
  }).returning();
  track(async () => { await db.delete(s.treasuryMovements).where(eq(s.treasuryMovements.id, movement.id)); });
  return movement;
}

async function mkShipment() {
  const [customer] = await db.insert(s.customers).values({ name: `card168 cust ${suffix}-${cleanup.length}` }).returning();
  track(async () => { await db.delete(s.customers).where(eq(s.customers.id, customer.id)); });
  const [route] = await db.insert(s.routes).values({ name: `card168 route ${suffix}-${cleanup.length}` }).returning();
  track(async () => { await db.delete(s.routes).where(eq(s.routes.id, route.id)); });
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'PENDING_DATE',
  }).returning();
  track(async () => { await db.delete(s.shipments).where(eq(s.shipments.id, shipment.id)); });
  return shipment;
}

async function mkCostEntry(staff: { id: number }, shipmentId: number, amount: number) {
  const [link] = await db.insert(s.userShipmentLinks).values({ userId: staff.id, shipmentId }).onConflictDoNothing().returning();
  if (link) {
    track(async () => { await db.delete(s.userShipmentLinks).where(and(eq(s.userShipmentLinks.userId, staff.id), eq(s.userShipmentLinks.shipmentId, shipmentId))); });
  }
  const created = await createOpsExpense(staff.id, {
    shipmentId,
    expenseTypeCode: 'OTHER',
    amount,
    paidAt: TODAY,
    costGroup: 'OPS_REGULAR',
    feeName: `card168 phí ${cleanup.length}`,
    customerChargeAmount: 0,
    note: `card168 không thu khách ${cleanup.length}`,
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

async function sourceVersion(entryId: number) {
  const [source] = await db.select({ version: s.expenseAccountingSources.version }).from(s.expenseAccountingSources)
    .where(and(eq(s.expenseAccountingSources.sourceKind, 'OPS'), eq(s.expenseAccountingSources.sourceId, entryId)));
  return source.version;
}

async function mkFundedAdvance(actor: ExpenseActor, staff: { id: number }, amount: number, account: { id: number }, valueDate: string = TODAY) {
  const reference = nextRef();
  const advance = await db.transaction(async (tx) => recordFundedOpsAdvance(tx, actor, {
    opsUserId: staff.id, amount, reason: `card168 advance ${suffix}`, treasuryAccountId: account.id,
    valueDate, physicalReference: reference,
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

async function mkLot(actor: ExpenseActor, staff: { id: number }, entryIds: number[], advances: Array<{ advanceRequestId: number; amount: number }>) {
  const entries: Array<{ sourceKind: 'OPS'; sourceId: number; expectedVersion: number }> = [];
  for (const sourceId of entryIds) {
    entries.push({ sourceKind: 'OPS' as const, sourceId, expectedVersion: await sourceVersion(sourceId) });
  }
  const lot = await db.transaction(async (tx) => createExpenseReconciliation(tx, actor, {
    opsUserId: staff.id, from: TODAY, to: TODAY,
    entries,
    advances,
    note: `card168 lot ${suffix}`,
  }));
  track(async () => { await db.delete(s.expenseReconciliationAdvances).where(eq(s.expenseReconciliationAdvances.reconciliationId, lot.id)); });
  track(async () => { await db.delete(s.expenseReconciliations).where(eq(s.expenseReconciliations.id, lot.id)); });
  return lot;
}

describe('card 20260928_168 - sổ quỹ theo kỳ + hội tụ với báo cáo hoàn ứng', () => {
  test('AC3: the period window carries the opening; TÀI KHOẢN OPS closing IS the 169 remaining, before and after the THU', async () => {
    const actorRow = await mkActor();
    const finance: ExpenseActor = { userId: actorRow.id, role: Role.ACCOUNTANT };
    const staff = await mkStaff();
    const shipment = await mkShipment();
    const funding = await mkAccount();

    // A POSTED movement BEFORE the window: it must roll into the carried
    // opening (số dư đầu kỳ lũy kế đến 'from') and never into window thu/chi.
    await mkMovement(funding.id, 'IN', '2000000', YESTERDAY);

    // Today, inside the window: a funded 1.000.000đ advance (treasury OUT) and
    // a confirmed 400.000đ cost the staff paid personally.
    const advance = await mkFundedAdvance(finance, staff, 1000000, funding);
    const entry = await mkCostEntry(staff, shipment.id, 400000);
    // The đợt allocates 500.000đ of the advance against the 400.000đ cost, so
    // the staff owes the lot 100.000đ (difference −100.000) and still holds
    // 500.000đ of unconsumed advance.
    const lot = await mkLot(finance, staff, [entry], [{ advanceRequestId: advance.id, amount: 500000 }]);

    // ── Period math (ruling câu 2) ─────────────────────────────────────────
    const book = await listFundBook('COMPANY', { from: TODAY, to: TODAY });
    const row = book.accounts.find((account) => account.accountId === funding.id);
    assert.ok(row, 'fixture account must sit in the COMPANY fund book');
    assert.equal(row.openingBalance, 2000000, 'đầu kỳ lũy kế đến from: yesterday IN carried, never windowed');
    assert.equal(row.totalIn, 0, 'no IN movement inside [from, to]');
    assert.equal(row.totalOut, 1000000, 'the advance funding OUT is inside the window');
    assert.equal(row.bookBalance, 1000000, 'closing = carried opening + thu − chi');
    assert.equal(row.movements.length, 1, 'only the window movement is listed');

    // Without a period the book keeps reading whole history (the card 9
    // contract is unchanged).
    const whole = await listFundBook('COMPANY');
    const wholeRow = whole.accounts.find((account) => account.accountId === funding.id)!;
    assert.equal(wholeRow.openingBalance, 0, 'no period: the account base opening');
    assert.equal(wholeRow.totalIn, 2000000);
    assert.equal(wholeRow.totalOut, 1000000);
    assert.equal(wholeRow.movements.length, 2);

    // ── Convergence BEFORE the phiếu (ruling câu 1) ────────────────────────
    const report = await listMonthlyReconciliationReport(finance, { from: TODAY, to: TODAY });
    const reportRow = report.rows.find((r) => r.staffId === staff.id);
    assert.ok(reportRow, 'staff row present in the 169 report');
    assert.equal(reportRow.remaining, 500000, 'min(đã ứng 1tr, đã cấp 1tr) − đã tiêu 500k');

    const opsItem = book.opsAdvance.items.find((item) => item.staffId === staff.id);
    assert.ok(opsItem, 'the TÀI KHOẢN OPS section carries the staff row');
    assert.equal(opsItem.outstanding, 500000);
    assert.equal(book.opsAdvance.totalOutstanding, report.totals.remaining,
      'TÀI KHOẢN OPS closing === the 169 report remaining on the SAME period');
    assert.equal(opsItem.outstanding, reportRow.remaining,
      'per staff: the book number and the report number are one definition');

    // ── The phiếu THU hoàn ứng posts; both numbers must converge down ──────
    // PRD §9.2: "hoàn ứng thực tế giảm nghĩa vụ còn lại đúng một lần" and
    // "sau khi phiếu post, sổ quỹ và báo cáo hội tụ về một số".
    const collection = await mkAccount();
    const refundReference = nextRef();
    const refund = await db.transaction(async (tx) => refundExpenseReconciliation(tx, finance, lot.id, {
      treasuryAccountId: collection.id, valueDate: TODAY, physicalReference: refundReference, amount: 100000, reason: 'card168 thu hoan ung',
    }));
    track(async () => {
      await db.delete(s.expenseCashVouchers).where(eq(s.expenseCashVouchers.id, refund.id));
      const [movement] = await db.select().from(s.treasuryMovements).where(eq(s.treasuryMovements.physicalReference, refundReference));
      if (movement) {
        if (movement.ledgerEntryId) await db.delete(s.ledger).where(eq(s.ledger.id, movement.ledgerEntryId));
        await db.delete(s.treasuryMovements).where(eq(s.treasuryMovements.id, movement.id));
      }
    });

    const bookAfter = await listFundBook('COMPANY', { from: TODAY, to: TODAY });
    const reportAfter = await listMonthlyReconciliationReport(finance, { from: TODAY, to: TODAY });
    const reportRowAfter = reportAfter.rows.find((r) => r.staffId === staff.id);
    assert.ok(reportRowAfter);
    assert.equal(reportRowAfter.remaining, 400000, 'the returned 100k reduces what the staff holds — exactly once');

    const opsItemAfter = bookAfter.opsAdvance.items.find((item) => item.staffId === staff.id);
    assert.ok(opsItemAfter);
    assert.equal(opsItemAfter.outstanding, 400000, 'the TÀI KHOẢN OPS closing drops with the phiếu THU');
    assert.equal(bookAfter.opsAdvance.totalOutstanding, reportAfter.totals.remaining,
      'after the phiếu posts, the sổ quỹ and the report still read one number');

    // The collection account's own period row: the THU landed inside the window.
    const collectionRow = bookAfter.accounts.find((account) => account.accountId === collection.id);
    assert.ok(collectionRow);
    assert.equal(collectionRow.totalIn, 100000);
    assert.equal(collectionRow.bookBalance, 100000);

    // The đợt cap settles exactly once: a second THU finds nothing left.
    await expectApiError(db.transaction(async (tx) => refundExpenseReconciliation(tx, finance, lot.id, {
      treasuryAccountId: collection.id, valueDate: TODAY, physicalReference: nextRef(), amount: 1, reason: 'card168 double THU',
    })), 409, 'chỉ còn phải hoàn 0');
  });

  test('a reversed period (from > to) is refused', async () => {
    await expectApiError(listFundBook('COMPANY', { from: '2026-09-30', to: '2026-09-01' }), 400, 'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc');
  });
});

after(async () => {
  for (const fn of cleanup) {
    try { await fn(); } catch (err) { console.warn('[card168] cleanup:', (err as Error).message); }
  }
  try { await disconnectRedis(); } catch { /* already-closed is fine */ }
  try { await client.end({ timeout: 1 }); } catch { /* ignore */ }
});
