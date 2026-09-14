import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { runInTx } from '../lib/tx';
import { submitExpense, reviewExpense } from '../services/expense.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdSupplierIds: number[] = [];
const createdCategoryIds: number[] = [];
const createdExpenseIds: number[] = [];
const createdUserIds: number[] = [];

before(async () => {
  const [submitter] = await db.insert(s.users).values({ username: `exp-sub-${suffix}`, passwordHash: 'x', role: 'MANAGER', status: 'ACTIVE' }).returning();
  const [checker] = await db.insert(s.users).values({ username: `exp-chk-${suffix}`, passwordHash: 'x', role: 'ACCOUNTANT', status: 'ACTIVE' }).returning();
  const [approver] = await db.insert(s.users).values({ username: `exp-app-${suffix}`, passwordHash: 'x', role: 'ADMIN', status: 'ACTIVE' }).returning();
  createdUserIds.push(submitter.id, checker.id, approver.id);
  const [supplier] = await db.insert(s.suppliers).values({ name: `Exp approval supplier ${suffix}`, status: 'ACTIVE' }).returning();
  const [category] = await db.insert(s.expenseCategories).values({ name: `Exp approval category ${suffix}`, status: 'ACTIVE' }).returning();
  createdSupplierIds.push(supplier.id);
  createdCategoryIds.push(category.id);
  (globalThis as Record<string, unknown>).__expFixture = { submitter, checker, approver, supplier, category };
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
    supplierId: f.supplier.id,
    categoryId: f.category.id,
    amount: '123000',
    paymentStatus: 'UNPAID',
    note: 'QA-086 dual-control',
    receiptId: 'QA-EXP-0914-01',
  } as Parameters<typeof submitExpense>[1];
}

const fixture = () => (globalThis as unknown as { __expFixture: { submitter: { userId: number; role: string }; checker: { userId: number; role: string }; approver: { userId: number; role: string } } }).__expFixture;

async function ledgerCount(supplierId: number): Promise<number> {
  const rows = await db.select({ id: s.ledger.id }).from(s.ledger)
    .where(and(eq(s.ledger.entityType, 'VENDOR'), eq(s.ledger.entityId, supplierId), eq(s.ledger.txnType, 'VENDOR_EXPENSE')));
  return rows.length;
}

describe('expense dual-control review', () => {
  test('submission parks the expense PENDING with zero supplier debt', async () => {
    const f = fixture();
    const { expense } = await runInTx(undefined, async (tx) => submitExpense(tx, await baseInput(), 'Cần duyệt chi phí QA', f.submitter.id));
    createdExpenseIds.push(expense.id);
    assert.equal(expense.approvalStatus, 'PENDING');
    const before = await ledgerCount(expense.supplierId);
    assert.equal(await ledgerCount(expense.supplierId), before, 'submission must not post supplier debt');
  });

  test('the submitter cannot check their own request', async () => {
    const f = fixture();
    const { expense } = await runInTx(undefined, async (tx) => submitExpense(tx, await baseInput(), 'second', f.submitter.id));
    createdExpenseIds.push(expense.id);
    await assert.rejects(
      () => reviewExpense({ expenseId: expense.id, action: 'CHECK', actorId: f.submitter.id, actorRole: 'MANAGER' }),
      /không được tự kiểm tra/,
    );
  });

  test('check → different-actor approve posts the supplier debt exactly once; retries 409', async () => {
    const f = fixture();
    const { expense } = await runInTx(undefined, async (tx) => submitExpense(tx, await baseInput(), 'third', f.submitter.id));
    createdExpenseIds.push(expense.id);

    await assert.rejects(
      () => reviewExpense({ expenseId: expense.id, action: 'APPROVE', actorId: f.approver.id, actorRole: 'ADMIN' }),
      /cần một người kiểm tra/,
    );

    const checked = await reviewExpense({ expenseId: expense.id, action: 'CHECK', actorId: f.checker.id, actorRole: 'ACCOUNTANT' });
    assert.equal(checked.approvalStatus, 'CHECKED');

    await assert.rejects(
      () => reviewExpense({ expenseId: expense.id, action: 'APPROVE', actorId: f.checker.id, actorRole: 'ACCOUNTANT' }),
      /hai người khác nhau|ADMIN\/MANAGER/,
    );

    const approved = await reviewExpense({ expenseId: expense.id, action: 'APPROVE', actorId: f.approver.id, actorRole: 'ADMIN' });
    assert.equal(approved.approvalStatus, 'APPROVED');
    assert.equal(await ledgerCount(expense.supplierId), 1);

    await assert.rejects(
      () => reviewExpense({ expenseId: expense.id, action: 'APPROVE', actorId: f.approver.id, actorRole: 'ADMIN' }),
      /không ở trạng thái chờ phê duyệt/,
    );
    assert.equal(await ledgerCount(expense.supplierId), 1, 'retry must not post a second ledger entry');
  });

  test('rejection is terminal with no posting', async () => {
    const f = fixture();
    const { expense } = await runInTx(undefined, async (tx) => submitExpense(tx, await baseInput(), 'fourth', f.submitter.id));
    createdExpenseIds.push(expense.id);
    const before = await ledgerCount(expense.supplierId);
    const rejected = await reviewExpense({ expenseId: expense.id, action: 'REJECT', actorId: f.approver.id, actorRole: 'ADMIN', reason: 'Không đủ hóa đơn' });
    assert.equal(rejected.approvalStatus, 'REJECTED');
    assert.equal(rejected.rejectionReason, 'Không đủ hóa đơn');
    assert.equal(await ledgerCount(expense.supplierId), before, 'rejection must not post supplier debt');
  });
});
