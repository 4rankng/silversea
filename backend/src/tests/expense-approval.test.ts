import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { runInTx } from '../lib/tx';
import { submitExpense, settleExpensesForPayment, restoreExpensesForPaymentReversal } from '../services/expense.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdSupplierIds: number[] = [];
const createdCategoryIds: number[] = [];
const createdExpenseIds: number[] = [];
const createdUserIds: number[] = [];

before(async () => {
  const [submitter] = await db.insert(s.users).values({ username: `exp-sub-${suffix}`, passwordHash: 'x', role: 'MANAGER', status: 'ACTIVE' }).returning();
  createdUserIds.push(submitter.id);
  const [supplier] = await db.insert(s.suppliers).values({ name: `Exp approval supplier ${suffix}`, status: 'ACTIVE' }).returning();
  const [category] = await db.insert(s.expenseCategories).values({ name: `Exp approval category ${suffix}`, status: 'ACTIVE' }).returning();
  createdSupplierIds.push(supplier.id);
  createdCategoryIds.push(category.id);
  (globalThis as Record<string, unknown>).__expFixture = { submitter, supplier, category };
});

after(async () => {
  await db.delete(s.ledger).where(and(eq(s.ledger.entityType, 'VENDOR'), inArray(s.ledger.entityId, createdSupplierIds)));
  if (createdExpenseIds.length) await db.delete(s.expenses).where(inArray(s.expenses.id, createdExpenseIds));
  await db.delete(s.suppliers).where(inArray(s.suppliers.id, createdSupplierIds));
  await db.delete(s.expenseCategories).where(inArray(s.expenseCategories.id, createdCategoryIds));
  await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
  await client.end();
});

async function baseInput() {
  const f = (globalThis as unknown as { __expFixture: { category: { id: number } } }).__expFixture;
  const [supplier] = await db.insert(s.suppliers).values({ name: `Exp approval supplier ${suffix}-${createdSupplierIds.length}`, status: 'ACTIVE' }).returning();
  createdSupplierIds.push(supplier.id);
  return {
    expenseDate: '2026-09-14',
    supplierId: supplier.id,
    categoryId: f.category.id,
    amount: '123000',
    paymentStatus: 'UNPAID',
    note: 'direct-save coverage',
    receiptId: `QA-EXP-${suffix}-${createdExpenseIds.length}`,
  } as Parameters<typeof submitExpense>[1];
}

const fixture = () => (globalThis as unknown as { __expFixture: { submitter: { id: number; role: string } } }).__expFixture;

async function ledgerCount(supplierId: number): Promise<number> {
  const rows = await db.select({ id: s.ledger.id }).from(s.ledger)
    .where(and(eq(s.ledger.entityType, 'VENDOR'), eq(s.ledger.entityId, supplierId), eq(s.ledger.txnType, 'VENDOR_EXPENSE')));
  return rows.length;
}

// KP-149/KP-150 (approval-removal arc): submission is DIRECT-SAVE — the row
// lands APPROVED with the supplier debt posted immediately; there is no
// PENDING→CHECKED→APPROVED lifecycle anymore.
describe('expense direct-save submission', () => {
  test('submission lands APPROVED and posts the supplier debt exactly once', async () => {
    const f = fixture();
    const { expense } = await runInTx(undefined, async (tx) => submitExpense(tx, await baseInput(), 'Chi phí QA ghi thẳng', f.submitter.id));
    createdExpenseIds.push(expense.id);
    assert.equal(expense.approvalStatus, 'APPROVED');
    assert.ok(expense.approvedAt, 'approvedAt stamps the direct save');
    assert.equal(await ledgerCount(expense.supplierId), 1, 'supplier debt posts at submission');
  });
});

// QA-089: payment status is ledger-backed — direct flips are rejected and
// settlements flow through the payment linkage helpers.
describe('expense payment-status ledger backing', () => {
  test('rejects paid-on-create submissions', async () => {
    const f = fixture();
    const input = await baseInput();
    await assert.rejects(
      () => runInTx(undefined, (tx) => submitExpense(tx, { ...input, paymentStatus: 'PAID' }, 'reason', f.submitter.id)),
      /chỉ được ghi dưới dạng Ghi nợ/,
    );
  });

  test('settle helper flips APPROVED/UNPAID rows once and records the payment; guards reject bad linkage', async () => {
    const f = fixture();
    const input = await baseInput();
    const { expense } = await runInTx(undefined, (tx) => submitExpense(tx, input, 'reason', f.submitter.id));
    createdExpenseIds.push(expense.id);
    const expenseAmount = Number(expense.amount);

    // Wrong supplier 409s.
    await assert.rejects(
      () => runInTx(undefined, (tx) => settleExpensesForPayment({ allocations: [{ expenseId: expense.id, amount: expenseAmount }], supplierId: expense.supplierId + 1, paymentLedgerId: 9001, paymentAmount: expenseAmount, transaction: tx })),
      /không thuộc nhà cung cấp/,
    );
    await runInTx(undefined, (tx) => settleExpensesForPayment({ allocations: [{ expenseId: expense.id, amount: expenseAmount }], supplierId: expense.supplierId, paymentLedgerId: 9001, paymentAmount: expenseAmount, transaction: tx }));
    const [settled] = await db.select().from(s.expenses).where(eq(s.expenses.id, expense.id));
    assert.equal(settled.paymentStatus, 'PAID');
    assert.equal(settled.settledByPaymentId, 9001);

    // Already paid 409s (allocation exceeds remaining balance).
    await assert.rejects(
      () => runInTx(undefined, (tx) => settleExpensesForPayment({ allocations: [{ expenseId: expense.id, amount: expenseAmount }], supplierId: expense.supplierId, paymentLedgerId: 9002, paymentAmount: expenseAmount, transaction: tx })),
      /vượt số dư còn lại/,
    );
  });

  test('restore returns rows still pointing at the payment; a re-settled row keeps PAID', async () => {
    const f = fixture();
    const input = await baseInput();
    const { expense } = await runInTx(undefined, (tx) => submitExpense(tx, input, 'reason', f.submitter.id));
    createdExpenseIds.push(expense.id);
    const expenseAmount = Number(expense.amount);
    await runInTx(undefined, (tx) => settleExpensesForPayment({ allocations: [{ expenseId: expense.id, amount: expenseAmount }], supplierId: expense.supplierId, paymentLedgerId: 9101, paymentAmount: expenseAmount, transaction: tx }));
    // A newer payment re-settles the row (reversal of 9101 must NOT touch it
    // because the allocation record for 9202 still covers the expense).
    await runInTx(undefined, (tx) => settleExpensesForPayment({ allocations: [{ expenseId: expense.id, amount: expenseAmount }], supplierId: expense.supplierId, paymentLedgerId: 9202, paymentAmount: expenseAmount, transaction: tx }));
    const restored = await runInTx(undefined, (tx) => restoreExpensesForPaymentReversal({ paymentLedgerId: 9101, transaction: tx }));
    // 9101's allocation was superseded — after deleting it, the 9202 allocation
    // still covers the full amount, so the expense stays PAID.
    const [still] = await db.select().from(s.expenses).where(eq(s.expenses.id, expense.id));
    assert.equal(still.paymentStatus, 'PAID');
    // Restoring the newer payment works.
    const restored2 = await runInTx(undefined, (tx) => restoreExpensesForPaymentReversal({ paymentLedgerId: 9202, transaction: tx }));
    assert.deepEqual(restored2, [expense.id]);
    const [back] = await db.select().from(s.expenses).where(eq(s.expenses.id, expense.id));
    assert.equal(back.paymentStatus, 'UNPAID');
    assert.equal(back.settledByPaymentId, null);
  });
});
