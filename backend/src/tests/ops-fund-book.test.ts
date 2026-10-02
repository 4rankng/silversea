// Card 20260923_13 — Sổ quỹ OPS scoped read-only (ADR 2026-09-24-ops-fund-book-scoped-read).
// Pins: (1) second-user invisibility (the RBAC contract), (2) closing==wallet formula,
// (3) closing vs accountant "Còn phải hoàn ứng" (the acceptance doc khớp check).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import { getOpsFundBook } from '../services/ops-wallet.service';

const ids: {
  users: number[]; customers: number[]; shipments: number[]; treasuryAccounts: number[];
  advances: number[]; ledgers: number[]; movements: number[]; expenses: number[];
  settlements: number[]; settlementRequests: number[];
} = { users: [], customers: [], shipments: [], treasuryAccounts: [], advances: [], ledgers: [], movements: [], expenses: [], settlements: [], settlementRequests: [] };
const key = `ops-fund-book-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const shortCode = ('SQ' + Date.now().toString(36)).slice(0, 20);

test('Sổ quỹ OPS: self-scoped entries, closing reconciles with wallet formula and accountant outstanding', async () => {
  const [owner] = await db.insert(s.users).values({ username: `${key}-owner`, passwordHash: 'x', role: Role.OPS, status: 'ACTIVE' }).returning();
  const [other] = await db.insert(s.users).values({ username: `${key}-other`, passwordHash: 'x', role: Role.OPS, status: 'ACTIVE' }).returning();
  ids.users.push(owner.id, other.id);

  const [customer] = await db.insert(s.customers).values({ name: key }).returning(); ids.customers.push(customer.id);
  const [shipment] = await db.insert(s.shipments).values({ customerId: customer.id, cargoMode: 'FCL', status: 'PENDING_DATE' }).returning(); ids.shipments.push(shipment.id);

  const [account] = await db.insert(s.treasuryAccounts).values({
    code: key, name: 'Sổ quỹ test fund', type: 'CASH', createdBy: owner.id, updatedBy: owner.id,
  }).returning(); ids.treasuryAccounts.push(account.id);

  // Owner: funded advance 1,000,000 + approved expense 600,000 + settlement allocating 600,000
  // → book closing 400,000 == accountant outstanding 400,000 (khớp).
  const [advance] = await db.insert(s.advanceRequests).values({
    requesterId: owner.id, amount: '1000000', reason: `Tạm ứng ${key}`, status: 'RECORDED',
  }).returning(); ids.advances.push(advance.id);
  const [ledgerRow] = await db.insert(s.ledger).values({
    txnType: 'OPS_ADVANCE', txnId: advance.id, entityType: 'FORWARDER', entityId: owner.id, balance: '0',
  }).returning(); ids.ledgers.push(ledgerRow.id);
  const [movement] = await db.insert(s.treasuryMovements).values({
    treasuryAccountId: account.id, direction: 'OUT', amount: '1000000', valueDate: '2026-09-20',
    sourceVersion: 1, paymentContractVersion: 1, physicalReference: `${key}-advance`, createdBy: owner.id,
  }).returning(); ids.movements.push(movement.id);
  await db.update(s.treasuryMovements).set({ ledgerEntryId: ledgerRow.id }).where(eq(s.treasuryMovements.id, movement.id));

  const [expense] = await db.insert(s.opsExpenseEntries).values({
    shipmentId: shipment.id, paidById: owner.id, expenseTypeCode: 'OTHER', amount: '600000',
    paidAt: '2026-09-22', approvalStatus: 'APPROVED',
  }).returning(); ids.expenses.push(expense.id);

  const [settlement] = await db.insert(s.advanceSettlements).values({
    code: shortCode, forwarderId: owner.id, totalExpenseAmount: '600000', refundAmount: '0', status: 'RECORDED',
  }).returning(); ids.settlements.push(settlement.id);
  const [allocation] = await db.insert(s.advanceSettlementRequests).values({
    settlementId: settlement.id, advanceRequestId: advance.id, allocatedAmount: '600000',
  }).returning(); ids.settlementRequests.push(allocation.id);

  // Foreign expense belonging to `other` — must never surface in owner's book.
  const [foreignExpense] = await db.insert(s.opsExpenseEntries).values({
    shipmentId: shipment.id, paidById: other.id, expenseTypeCode: 'OTHER', amount: '999000',
    paidAt: '2026-09-23', approvalStatus: 'APPROVED',
  }).returning(); ids.expenses.push(foreignExpense.id);

  const book = await getOpsFundBook(owner.id);

  // Scoping: owner sees own advance + expense; the other user's expense is invisible.
  const ownKeys = book.items.map((item) => item.key);
  assert.ok(ownKeys.includes(`advance-${advance.id}`), 'own funded advance visible');
  assert.ok(ownKeys.includes(`ops-expense-${expense.id}`), 'own expense visible');
  assert.ok(!ownKeys.some((k) => k === `ops-expense-${foreignExpense.id}`), 'other user’s expense invisible');

  // Reconciliation invariant: closing == wallet formula balance.
  assert.equal(book.closing, book.walletBalance, 'book closing equals wallet formula balance');
  assert.equal(book.closing, '400000', 'funded 1,000,000 − expense 600,000');

  // Acceptance doc khớp check: closing vs accountant "Còn phải hoàn ứng".
  assert.equal(book.outstandingAdvanceBalance, '400000', 'accountant outstanding = min(amount, funded) − consumed');
  assert.equal(book.matches, true, 'khớp on converged data');

  // Positive control: `other`'s own book DOES contain their expense.
  const otherBook = await getOpsFundBook(other.id);
  assert.ok(otherBook.items.some((item) => item.key === `ops-expense-${foreignExpense.id}`), 'positive control: other sees own expense');
  assert.equal(otherBook.items.some((item) => item.key === `ops-expense-${expense.id}`), false, 'owner’s expense invisible to other');
});

test('Sổ quỹ OPS: voided/rejected expenses excluded, unfunded advance emits no entry', async () => {
  const [owner] = await db.insert(s.users).values({ username: `${key}-owner2`, passwordHash: 'x', role: Role.OPS, status: 'ACTIVE' }).returning();
  ids.users.push(owner.id);
  const [customer] = await db.insert(s.customers).values({ name: `${key}-2` }).returning(); ids.customers.push(customer.id);
  const [shipment] = await db.insert(s.shipments).values({ customerId: customer.id, cargoMode: 'FCL', status: 'PENDING_DATE' }).returning(); ids.shipments.push(shipment.id);

  // RECORDED advance that never received cash → funded 0 → no book entry,
  // and no outstanding either (min(amount, funded) caps at 0).
  const [advance] = await db.insert(s.advanceRequests).values({
    requesterId: owner.id, amount: '500000', reason: `Chưa giao tiền ${key}`, status: 'RECORDED',
  }).returning(); ids.advances.push(advance.id);

  // VOIDED and REJECTED expenses consume nothing.
  const [voided] = await db.insert(s.opsExpenseEntries).values({
    shipmentId: shipment.id, paidById: owner.id, expenseTypeCode: 'OTHER', amount: '111000',
    paidAt: '2026-09-21', approvalStatus: 'VOIDED',
  }).returning(); ids.expenses.push(voided.id);
  const [rejected] = await db.insert(s.opsExpenseEntries).values({
    shipmentId: shipment.id, paidById: owner.id, expenseTypeCode: 'OTHER', amount: '222000',
    paidAt: '2026-09-21', approvalStatus: 'REJECTED',
  }).returning(); ids.expenses.push(rejected.id);

  const book = await getOpsFundBook(owner.id);
  assert.ok(!book.items.some((item) => item.key === `ops-expense-${voided.id}`), 'VOIDED expense excluded');
  assert.ok(!book.items.some((item) => item.key === `ops-expense-${rejected.id}`), 'REJECTED expense excluded');
  assert.ok(!book.items.some((item) => item.key === `advance-${advance.id}`), 'unfunded advance emits no entry');
  assert.equal(book.items.length, 0, 'book is empty for this user');
  assert.equal(book.closing, '0', 'closing 0 on empty book');
});

// Card 20260928_168, PM ruling 2026-09-29 câu 2 — the sổ quỹ reads over a
// period, and on ONE window it must equal "Còn phải hoàn ứng" from report 169.
// The chain is not assumed: book.outstandingAdvanceBalance comes from
// getOutstandingAdvanceBalance(userId), which IS
// getOutstandingAdvanceBalances(userId).totalOutstanding — the exact function
// card 20260928_169 pins report.remaining to. So comparing the two numbers
// compares the two boards over one window, which is the whole point.
test('Sổ quỹ OPS: lọc theo kỳ, và trên cùng khoảng ngày thì khớp "Còn phải hoàn ứng" của báo cáo 169', async () => {
  const [owner] = await db.insert(s.users).values({ username: `${key}-owner3`, passwordHash: 'x', role: Role.OPS, status: 'ACTIVE' }).returning();
  ids.users.push(owner.id);
  const [customer] = await db.insert(s.customers).values({ name: `${key}-3` }).returning(); ids.customers.push(customer.id);
  const [shipment] = await db.insert(s.shipments).values({ customerId: customer.id, cargoMode: 'FCL', status: 'PENDING_DATE' }).returning(); ids.shipments.push(shipment.id);
  const [account] = await db.insert(s.treasuryAccounts).values({
    code: `${key}-3`, name: 'Sổ quỹ period fund', type: 'CASH', createdBy: owner.id, updatedBy: owner.id,
  }).returning(); ids.treasuryAccounts.push(account.id);

  // Two events on two different days, so a window can actually cut between them.
  // The fund book dates an ADVANCE item by the REQUEST's createdAt (not the
  // funding movement's valueDate), so the fixture sets it explicitly: relying
  // on `now()` would move this row to "today" and quietly break the window math
  // below depending on the day the suite runs.
  const [advance] = await db.insert(s.advanceRequests).values({
    requesterId: owner.id, amount: '1000000', reason: `Tạm ứng period ${key}`, status: 'RECORDED',
    createdAt: new Date('2026-09-20T00:00:00Z'),
  }).returning(); ids.advances.push(advance.id);
  const [ledgerRow] = await db.insert(s.ledger).values({
    txnType: 'OPS_ADVANCE', txnId: advance.id, entityType: 'FORWARDER', entityId: owner.id, balance: '0',
  }).returning(); ids.ledgers.push(ledgerRow.id);
  const [movement] = await db.insert(s.treasuryMovements).values({
    treasuryAccountId: account.id, direction: 'OUT', amount: '1000000', valueDate: '2026-09-20',
    sourceVersion: 1, paymentContractVersion: 1, physicalReference: `${key}-period-advance`, createdBy: owner.id,
  }).returning(); ids.movements.push(movement.id);
  await db.update(s.treasuryMovements).set({ ledgerEntryId: ledgerRow.id }).where(eq(s.treasuryMovements.id, movement.id));

  const [expense] = await db.insert(s.opsExpenseEntries).values({
    shipmentId: shipment.id, paidById: owner.id, expenseTypeCode: 'OTHER', amount: '600000',
    paidAt: '2026-09-25', approvalStatus: 'APPROVED',
  }).returning(); ids.expenses.push(expense.id);
  const [settlement] = await db.insert(s.advanceSettlements).values({
    code: `${shortCode}P`, forwarderId: owner.id, totalExpenseAmount: '600000', refundAmount: '0', status: 'RECORDED',
  }).returning(); ids.settlements.push(settlement.id);
  const [allocation] = await db.insert(s.advanceSettlementRequests).values({
    settlementId: settlement.id, advanceRequestId: advance.id, allocatedAmount: '600000',
  }).returning(); ids.settlementRequests.push(allocation.id);

  const all = await getOpsFundBook(owner.id);
  assert.equal(all.closing, '400000', 'whole history: 1,000,000 − 600,000');

  // No window asked for: the opening is 0 and the closing is the whole-history
  // closing, so an existing caller that passes no params sees no behaviour change.
  assert.deepEqual(all.period, { from: null, to: null });
  assert.equal(all.periodOpening, '0', 'nothing sits before an unbounded window');
  assert.equal(all.periodClosing, all.closing);
  assert.equal(all.periodIn, '1000000');
  assert.equal(all.periodOut, '600000');

  // AC4 — one window covering the staff's whole history: the sổ quỹ's period
  // closing and the accountant's "Còn phải hoàn ứng" are the same number.
  const full = await getOpsFundBook(owner.id, { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(full.period, { from: '2026-09-01', to: '2026-09-30' });
  assert.equal(full.periodClosing, full.outstandingAdvanceBalance, 'period closing == "Còn phải hoàn ứng" on the same window');
  assert.equal(full.periodClosing, '400000');
  assert.equal(full.periodOpening, '0');
  assert.equal(full.closing, full.closing, 'whole-history closing unchanged by a window');
  assert.equal(full.matches, true, 'the khớp check still judges the whole history, not the window');

  // A window that cuts between the two events: the opening is the balance
  // BEFORE `from` (the 09-20 advance), and the closing is that opening plus the
  // window's net — the balance at the end of `to`, NOT the window's net alone.
  const narrow = await getOpsFundBook(owner.id, { from: '2026-09-25', to: '2026-09-25' });
  assert.equal(narrow.periodOpening, '1000000', 'the 09-20 advance rolled into the opening');
  assert.equal(narrow.periodIn, '0');
  assert.equal(narrow.periodOut, '600000');
  assert.equal(narrow.periodClosing, '400000', 'opening + the window net = the balance at the end of `to`');
  assert.equal(narrow.periodClosing, narrow.closing,
    'this window reaches the last item, so its closing IS the whole-history closing');
  assert.equal(
    Number(narrow.periodOpening) + (Number(narrow.periodIn) - Number(narrow.periodOut)),
    Number(narrow.periodClosing),
    'periodOpening + (net in window) always reconstructs periodClosing',
  );

  // Regression (pre-demo audit): a window that ENDS BEFORE the later item. The
  // opening must be what preceded `from` — nothing — not `closing − windowNet`,
  // which silently counted the 09-25 expense (dated after `to`) as opening.
  const early = await getOpsFundBook(owner.id, { from: '2026-09-01', to: '2026-09-21' });
  assert.equal(early.periodOpening, '0', 'nothing precedes the window');
  assert.equal(early.periodClosing, '1000000', 'the balance at the end of `to`: the 09-25 expense is not in it');
  assert.equal(Number(early.periodClosing) - Number(all.closing), 600000,
    'the item dated AFTER `to` never lands in this window — neither in its closing nor in its opening');

  // The row list must be windowed, not just the summary. Found by a live smoke
  // run, not by a unit test: the sums filtered correctly while `items` still
  // carried every row, so the table would have shown out-of-window activity
  // under a filtered summary.
  const narrowRows = await getOpsFundBook(owner.id, { from: '2026-09-25', to: '2026-09-25' });
  assert.equal(narrowRows.items.length, 1, 'only the in-window row is returned');
  assert.deepEqual(narrowRows.items.map((item) => item.key), [`ops-expense-${expense.id}`]);
  assert.ok(
    narrowRows.items.every((item) => item.date >= '2026-09-25' && item.date <= '2026-09-25'),
    'no row outside the window survives',
  );
  assert.ok(narrowRows.items.length < all.items.length, 'the row list is strictly narrower than the whole history');
  // And with no window the whole history is still returned in full.
  assert.equal(all.items.length, 2, 'no window returns every row');
  assert.deepEqual(
    all.items.map((item) => item.key).sort(),
    [`advance-${advance.id}`, `ops-expense-${expense.id}`].sort(),
    'both the advance and the expense are present when nothing is filtered',
  );
});

after(async () => {
  try {
    if (ids.settlementRequests.length) await db.delete(s.advanceSettlementRequests).where(inArray(s.advanceSettlementRequests.id, ids.settlementRequests));
    if (ids.settlements.length) await db.delete(s.advanceSettlements).where(inArray(s.advanceSettlements.id, ids.settlements));
    if (ids.movements.length) await db.delete(s.treasuryMovements).where(inArray(s.treasuryMovements.id, ids.movements));
    if (ids.ledgers.length) await db.delete(s.ledger).where(inArray(s.ledger.id, ids.ledgers));
    if (ids.advances.length) await db.delete(s.advanceRequests).where(inArray(s.advanceRequests.id, ids.advances));
    if (ids.expenses.length) await db.delete(s.opsExpenseEntries).where(inArray(s.opsExpenseEntries.id, ids.expenses));
    if (ids.shipments.length) await db.delete(s.shipments).where(inArray(s.shipments.id, ids.shipments));
    if (ids.customers.length) await db.delete(s.customers).where(inArray(s.customers.id, ids.customers));
    if (ids.treasuryAccounts.length) await db.delete(s.treasuryAccounts).where(inArray(s.treasuryAccounts.id, ids.treasuryAccounts));
    if (ids.users.length) await db.delete(s.users).where(inArray(s.users.id, ids.users));
  } finally {
    await client.end();
  }
});
