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
  users: number[]; customers: number[]; shipments: number[]; treasuryAccount?: number;
  advances: number[]; ledgers: number[]; movements: number[]; expenses: number[];
  settlements: number[]; settlementRequests: number[];
} = { users: [], customers: [], shipments: [], advances: [], ledgers: [], movements: [], expenses: [], settlements: [], settlementRequests: [] };
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
  }).returning(); ids.treasuryAccount = account.id;

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
    if (ids.treasuryAccount) await db.delete(s.treasuryAccounts).where(eq(s.treasuryAccounts.id, ids.treasuryAccount));
    if (ids.users.length) await db.delete(s.users).where(inArray(s.users.id, ids.users));
  } finally {
    await client.end();
  }
});
