/**
 * Card 377 (REQ-5.10-09) — the số-khớp condition between the Sổ quỹ's
 * "TÀI KHOẢN OPS" entry and the "Báo cáo tổng hợp hoàn ứng": at the same
 * instant, the remaining advance the book reports per staff and in total MUST
 * equal the report's "Còn phải hoàn ứng" on the same staff and in its totals.
 * Service-level suite; fixtures prefix `card377-`, isolation runner (throwaway
 * DB), sibling of card168/card169.
 *
 * What is proven, with real funded advances, confirmed costs, a đợt lot and a
 * phiếu THU posted through the real engines:
 *   1. listFundBook('COMPANY').opsAdvance and
 *      listMonthlyReconciliationReport(...).rows agree EXACTLY (===, per staff
 *      and in totals) on two consecutive reads with no write in between —
 *      before and after a phiếu THU. Both surfaces read the same canonical
 *      getOutstandingAdvanceBalances() (advance-shared.service.ts), whose
 *      per-staff math runs through shared round2dp(); no surface recomputes
 *      the number client-side.
 *   2. The phiếu THU hoàn ứng (staff returns cash) subtracts the return on
 *      BOTH surfaces at once — the silent end-of-day drift class the card
 *      names ("lỗi âm thầm mà người dùng chỉ phát hiện khi đối chiếu cuối
 *      ngày") is closed by construction, and this suite keeps it closed.
 *
 * Formula note (recorded, not re-litigated): the spec's verbatim
 * "Còn lại = Số tiền ĐNTT − Số tiền đã ứng" is superseded for the closing
 * number by the 2026-09-29 PM ruling (card 168 board "RULING PM" câu 1):
 * Còn phải hoàn ứng = min(đã ứng, đã cấp) − đã tiêu − đã trả, the granted
 * money still unconsumed. Card 169's suite pins the report to that ruling;
 * card 377's own "Cần chốt với khách hàng" list keeps the ĐNTT source open.
 * The assertions below therefore pin the OWNER-ruled equality (Sổ quỹ ↔
 * report) and the display columns, and document — not assert — where the
 * spec-verbatim arithmetic would differ.
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
import type { ExpenseActor } from '../services/expense-accounting-write.service';
import { listFundBook } from '../services/treasury-fund-book.service';
import { getOutstandingAdvanceBalances } from '../services/advance-shared.service';
import { Role, TxnType } from '@tingting/shared';
import { disconnectRedis } from '../lib/redis';
import { invalidateReportCaches } from '../lib/report-cache';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TODAY = new Date().toISOString().slice(0, 10);

const cleanup: Array<() => Promise<void>> = [];
const track = (fn: () => Promise<void>) => cleanup.unshift(fn);
const refCounter = { value: 0 };
const nextRef = () => `card377-${suffix}-${++refCounter.value}`;

async function mkActor() {
  const [acc] = await db.insert(s.users).values({
    username: `card377-${suffix}-acct-${cleanup.length}`, passwordHash: 'x', role: 'ACCOUNTANT',
  }).returning();
  track(async () => { await db.delete(s.users).where(eq(s.users.id, acc.id)); });
  return acc;
}

async function mkStaff() {
  const [u] = await db.insert(s.users).values({
    username: `card377-${suffix}-ops-${cleanup.length}`, passwordHash: 'x', role: 'OPS',
  }).returning();
  track(async () => { await db.delete(s.users).where(eq(s.users.id, u.id)); });
  return u;
}

async function mkAccount() {
  // A dedicated COMPANY-fund account per movement source so the fund-book
  // assertion reads exactly the phiếu this test posts — never seeded noise.
  const [account] = await db.insert(s.treasuryAccounts).values({
    code: `CARD377-${suffix}-${cleanup.length}`,
    name: `card377 acct ${suffix}-${cleanup.length}`,
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
  const [customer] = await db.insert(s.customers).values({ name: `card377 cust ${suffix}-${cleanup.length}` }).returning();
  track(async () => { await db.delete(s.customers).where(eq(s.customers.id, customer.id)); });
  const [route] = await db.insert(s.routes).values({ name: `card377 route ${suffix}-${cleanup.length}` }).returning();
  track(async () => { await db.delete(s.routes).where(eq(s.routes.id, route.id)); });
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'PENDING_DATE',
  }).returning();
  track(async () => { await db.delete(s.shipments).where(eq(s.shipments.id, shipment.id)); });
  return shipment;
}

/** A confirmed ops cost the staff paid personally (payable FORWARDER → the
 *  staff) — exactly the ĐNTT rows the report counts. */
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
    feeName: `card377 phí ${cleanup.length}`,
    customerChargeAmount: 0,
    note: `card377 không thu khách ${cleanup.length}`,
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

/** Fund an advance through the real engine (ledger credit + treasury OUT) on
 *  the given COMPANY account, and register the full cleanup chain. */
async function mkFundedAdvance(actor: ExpenseActor, staff: { id: number }, amount: number, account: { id: number }) {
  const reference = nextRef();
  const advance = await db.transaction(async (tx) => recordFundedOpsAdvance(tx, actor, {
    opsUserId: staff.id, amount, reason: `card377 advance ${suffix}`, treasuryAccountId: account.id,
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
    const [source] = await db.select({ version: s.expenseAccountingSources.version }).from(s.expenseAccountingSources)
      .where(and(eq(s.expenseAccountingSources.sourceKind, 'OPS'), eq(s.expenseAccountingSources.sourceId, sourceId)));
    entries.push({ sourceKind: 'OPS' as const, sourceId, expectedVersion: source.version });
  }
  const lot = await db.transaction(async (tx) => createExpenseReconciliation(tx, actor, {
    opsUserId: staff.id, from: TODAY, to: TODAY,
    entries,
    advances,
    note: `card377 lot ${suffix}`,
  }));
  track(async () => { await db.delete(s.expenseReconciliationAdvances).where(eq(s.expenseReconciliationAdvances.reconciliationId, lot.id)); });
  track(async () => { await db.delete(s.expenseReconciliations).where(eq(s.expenseReconciliations.id, lot.id)); });
  return lot;
}

/** Post a phiếu THU hoàn ứng (the staff returns advance cash) through the
 *  real engine and register its cleanup chain. */
async function postThuVoucher(actor: ExpenseActor, lotId: number, staffId: number, amount: number, account: { id: number }) {
  const reference = nextRef();
  const voucher = await db.transaction(async (tx) => refundExpenseReconciliation(tx, actor, lotId, {
    treasuryAccountId: account.id, valueDate: TODAY, physicalReference: reference,
    amount, reason: `card377 thu hoan ung ${suffix}`,
  }));
  track(async () => {
    await db.delete(s.expenseCashVouchers).where(eq(s.expenseCashVouchers.id, voucher.id));
    const [movement] = await db.select().from(s.treasuryMovements).where(eq(s.treasuryMovements.physicalReference, reference));
    if (movement) {
      if (movement.ledgerEntryId) await db.delete(s.ledger).where(eq(s.ledger.id, movement.ledgerEntryId));
      await db.delete(s.treasuryMovements).where(eq(s.treasuryMovements.id, movement.id));
    }
  });
  return voucher;
}

function bookItemOf(book: Awaited<ReturnType<typeof listFundBook>>, staffId: number) {
  return book.opsAdvance.items.find((item) => item.staffId === staffId);
}

describe('card 377 — so quy TAI KHOAN OPS matches bao cao tong hop hoan ung', () => {
  test('the book and the report read one number at the same instant — per staff and totals (two staff, partial lot)', async () => {
    const actorRow = await mkActor();
    const finance: ExpenseActor = { userId: actorRow.id, role: Role.ACCOUNTANT };
    const staffA = await mkStaff();
    const staffB = await mkStaff();
    const shipment = await mkShipment();

    // Staff A: granted 1.200.000, confirmed cost 800.000, the lot allocates
    // 1.000.000 → the staff still holds 200.000 before any phiếu.
    const costA = await mkCostEntry(staffA, shipment.id, 800000);
    const fundingA = await mkAccount();
    const advanceA = await mkFundedAdvance(finance, staffA, 1200000, fundingA);
    await mkLot(finance, staffA, [costA], [{ advanceRequestId: advanceA.id, amount: 1000000 }]);

    // Staff B: granted 500.000, confirmed cost 300.000, no lot yet → the whole
    // grant is still in the staff's hands.
    await mkCostEntry(staffB, shipment.id, 300000);
    const fundingB = await mkAccount();
    await mkFundedAdvance(finance, staffB, 500000, fundingB);

    // SAME INSTANT: two consecutive reads, no write in between.
    const report = await listMonthlyReconciliationReport(finance, { from: TODAY, to: TODAY });
    const book = await listFundBook('COMPANY');

    const rowA = report.rows.find((row) => row.staffId === staffA.id);
    const rowB = report.rows.find((row) => row.staffId === staffB.id);
    assert.ok(rowA, 'staff A has a report row');
    assert.ok(rowB, 'staff B has a report row');
    const bookA = bookItemOf(book, staffA.id);
    const bookB = bookItemOf(book, staffB.id);
    assert.ok(bookA, 'staff A sits in the Sổ quỹ TÀI KHOẢN OPS entry');
    assert.ok(bookB, 'staff B sits in the Sổ quỹ TÀI KHOẢN OPS entry');

    // The card's critical condition, exact on every staff row.
    assert.equal(rowA.remaining, bookA.outstanding, 'staff A: report Còn phải hoàn ứng === Sổ quỹ');
    assert.equal(rowB.remaining, bookB.outstanding, 'staff B: report Còn phải hoàn ứng === Sổ quỹ');
    assert.equal(rowA.remaining, 200000, 'staff A: min(1.200.000 đã cấp, 1.200.000 đã ứng) − 1.000.000 đã tiêu');
    assert.equal(rowB.remaining, 500000, 'staff B: whole grant still held');

    // Totals agree too — the number the accountant compares at end of day.
    // (The dev DB carries other seeded staff, so the shared total is asserted
    // as an equality between the two surfaces, not a hardcoded constant; the
    // fixture-scoped subtotal is asserted exactly below.)
    assert.equal(report.totals.remaining, book.opsAdvance.totalOutstanding,
      'report total Còn phải hoàn ứng === Sổ quỹ TÀI KHOẢN OPS total');
    assert.ok(report.totals.remaining >= rowA.remaining + rowB.remaining,
      'the two fixture rows are part of the shared total');

    // The canonical authority both surfaces read (round2dp math lives here,
    // not in any UI).
    const canonicalA = (await getOutstandingAdvanceBalances(staffA.id)).totalOutstanding;
    assert.equal(rowA.remaining, canonicalA);

    // Display columns: ĐNTT = confirmed costs of the window; ĐÃ ỨNG = the
    // grant minus what the lot consumed. Recorded divergence: the spec's
    // verbatim ĐNTT − ĐÃ ỨNG (800.000 − 200.000 = 600.000) is superseded by
    // the 2026-09-29 ruling for the closing number (see file header).
    assert.equal(rowA.dntt, 800000);
    assert.equal(rowA.advanced, 200000);
    assert.equal(rowB.dntt, 300000);
    assert.equal(rowB.advanced, 500000);
    assert.equal(rowA.direction, 'CTY_YEU_CAU_HOAN_TRA');
    assert.equal(rowA.note, 'Công ty yêu cầu nhân viên hoàn trả tạm ứng');
  });

  test('phiếu THU hoàn ứng subtracts the return on BOTH surfaces at once — the silent-drift guard', async () => {
    const actorRow = await mkActor();
    const finance: ExpenseActor = { userId: actorRow.id, role: Role.ACCOUNTANT };
    const staff = await mkStaff();
    const shipment = await mkShipment();
    const cost = await mkCostEntry(staff, shipment.id, 800000);
    const funding = await mkAccount();
    const advance = await mkFundedAdvance(finance, staff, 1200000, funding);
    const lot = await mkLot(finance, staff, [cost], [{ advanceRequestId: advance.id, amount: 1000000 }]);
    const collectionAccount = await mkAccount(); // opening 0 — only the THU moves it

    const before = await listMonthlyReconciliationReport(finance, { from: TODAY, to: TODAY });
    const bookBefore = await listFundBook('COMPANY');
    const rowBefore = before.rows.find((row) => row.staffId === staff.id);
    const bookRowBefore = bookItemOf(bookBefore, staff.id);
    assert.ok(rowBefore && bookRowBefore);
    assert.equal(rowBefore.remaining, bookRowBefore.outstanding);
    assert.equal(rowBefore.remaining, 200000);

    // The staff hands back 150.000 of the 200.000 still held. The THU cap is
    // the lot's own difference (allocated 1.000.000 − cost 800.000 = 200.000).
    await postThuVoucher(finance, lot.id, staff.id, 150000, collectionAccount);
    const bookAfterMovements = await listFundBook('COMPANY');
    assert.equal(
      bookAfterMovements.accounts.find((account) => account.accountId === collectionAccount.id)?.bookBalance,
      150000,
      'the phiếu THU really posted into the Sổ quỹ movements',
    );

    // SAME INSTANT after the phiếu: both surfaces dropped by the same 150.000.
    const after = await listMonthlyReconciliationReport(finance, { from: TODAY, to: TODAY });
    const bookAfter = await listFundBook('COMPANY');
    const rowAfter = after.rows.find((row) => row.staffId === staff.id);
    const bookRowAfter = bookItemOf(bookAfter, staff.id);
    assert.ok(rowAfter && bookRowAfter);
    assert.equal(rowAfter.remaining, bookRowAfter.outstanding,
      'report and Sổ quỹ cannot diverge after the phiếu posts');
    assert.equal(rowAfter.remaining, 50000, '200.000 held − 150.000 returned');
    assert.equal(after.totals.remaining, bookAfter.opsAdvance.totalOutstanding);
  });
});

after(async () => {
  for (const fn of cleanup) {
    try { await fn(); } catch (err) { console.warn('[card377] cleanup:', (err as Error).message); }
  }
  try { await invalidateReportCaches(); } catch { /* non-critical */ }
  try { await disconnectRedis(); } catch { /* already-closed is fine */ }
  try { await client.end({ timeout: 1 }); } catch { /* ignore */ }
});
