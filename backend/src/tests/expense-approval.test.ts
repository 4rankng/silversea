import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { runInTx } from '../lib/tx';
import { submitExpense, deleteExpense, updateExpense, settleExpensesForPayment, restoreExpensesForPaymentReversal, requestCompanyExpenseGovernance, applyCompanyExpenseGovernanceAction } from '../services/expense.service';

import { autoApplyGovernanceAction } from '../services/adjustment-governance.service';

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
  // Allocation rows keyed by the suite's hardcoded synthetic ledger ids must
  // go first — leftover rows from an interrupted run make the unallocated-
  // amount guard reject the next run's settlements.
  await db.delete(s.expensePaymentAllocations)
    .where(inArray(s.expensePaymentAllocations.paymentLedgerId, [9001, 9002, 9101, 9202, 9303]));
  await db.delete(s.ledger).where(and(eq(s.ledger.entityType, 'VENDOR'), inArray(s.ledger.entityId, createdSupplierIds)));
  if (createdExpenseIds.length) await db.delete(s.expenses).where(inArray(s.expenses.id, createdExpenseIds));
  await db.delete(s.suppliers).where(inArray(s.suppliers.id, createdSupplierIds));
  await db.delete(s.expenseCategories).where(inArray(s.expenseCategories.id, createdCategoryIds));
  await db.delete(s.auditLogs).where(inArray(s.auditLogs.userId, createdUserIds));
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
// lands RECORDED with the supplier debt posted immediately; there is no
// PENDING→CHECKED→APPROVED lifecycle anymore.
describe('expense direct-save submission', () => {
  test('submission lands RECORDED and posts the supplier debt exactly once', async () => {
    const f = fixture();
    const { expense } = await runInTx(undefined, async (tx) => submitExpense(tx, await baseInput(), 'Chi phí QA ghi thẳng', f.submitter.id));
    createdExpenseIds.push(expense.id);
    assert.equal(expense.approvalStatus, 'RECORDED');
    assert.equal(expense.approvedAt, null, 'direct recording does not fabricate reviewer timestamps');
    assert.equal(expense.approvedBy, null);
    assert.equal(await ledgerCount(expense.supplierId), 1, 'supplier debt posts at submission');
  });
});

describe('draft expense deletion', () => {
  test('deleting an unposted draft does not create a phantom supplier credit', async () => {
    const input = await baseInput();
    const [draft] = await db.insert(s.expenses).values({ ...input, validFrom: null, validTo: null, approvalStatus: 'DRAFT' }).returning();
    createdExpenseIds.push(draft.id);
    await runInTx(undefined, (tx) => deleteExpense(tx, draft.id, draft.updatedAt, fixture().submitter.id, true));
    const entries = await db.select().from(s.ledger).where(and(eq(s.ledger.entityType, 'VENDOR'), eq(s.ledger.entityId, input.supplierId)));
    assert.equal(entries.length, 0);
    const [deleted] = await db.select().from(s.expenses).where(eq(s.expenses.id, draft.id));
    assert.ok(deleted.deletedAt);
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
    // KP-075 allocation semantics: PAID ⇔ Σ allocations ≥ amount; a payment
    // may only allocate up to the row's REMAINING balance (over-cover is
    // rejected), so the old "newer payment re-settles on top" scenario is
    // unconstructable. Pin the coverage rule instead.
    await runInTx(undefined, (tx) => settleExpensesForPayment({ allocations: [{ expenseId: expense.id, amount: 50000 }], supplierId: expense.supplierId, paymentLedgerId: 9101, paymentAmount: 50000, transaction: tx }));
    const [partial] = await db.select().from(s.expenses).where(eq(s.expenses.id, expense.id));
    assert.equal(partial.paymentStatus, 'UNPAID', 'partial allocation leaves the row unpaid');

    await runInTx(undefined, (tx) => settleExpensesForPayment({ allocations: [{ expenseId: expense.id, amount: expenseAmount - 50000 }], supplierId: expense.supplierId, paymentLedgerId: 9202, paymentAmount: expenseAmount - 50000, transaction: tx }));
    const [covered] = await db.select().from(s.expenses).where(eq(s.expenses.id, expense.id));
    assert.equal(covered.paymentStatus, 'PAID');

    // Reversing the partial payment drops coverage below the amount — the
    // row returns to UNPAID and lands in the restored list.
    const restored = await runInTx(undefined, (tx) => restoreExpensesForPaymentReversal({ paymentLedgerId: 9101, transaction: tx }));
    assert.deepEqual(restored, [expense.id]);
    const [back] = await db.select().from(s.expenses).where(eq(s.expenses.id, expense.id));
    assert.equal(back.paymentStatus, 'UNPAID');
    assert.equal(back.settledByPaymentId, null);
  });
});

describe('company expense financial mutation integrity', () => {
  test('paid expense rejects direct financial mutation and deletion without changing source or ledger', async () => {
    const input = await baseInput();
    const { expense } = await runInTx(undefined, tx => submitExpense(tx, input, '', fixture().submitter.id));
    createdExpenseIds.push(expense.id);
    await db.update(s.expenses).set({ paymentStatus: 'PAID' }).where(eq(s.expenses.id, expense.id));
    await assert.rejects(() => runInTx(undefined, tx => updateExpense(tx, expense.id, { amount: '456000' }, expense.updatedAt, fixture().submitter.id, true)), /hoàn tác thanh toán/);
    await assert.rejects(() => runInTx(undefined, tx => deleteExpense(tx, expense.id, expense.updatedAt, fixture().submitter.id, true)), /đã thanh toán/);
    const [source] = await db.select().from(s.expenses).where(eq(s.expenses.id, expense.id));
    assert.equal(source.amount, '123000');
    assert.equal(source.deletedAt, null);
    assert.equal(await ledgerCount(input.supplierId), 1);
  });

  test('unpaid correction records a reversing entry and replacement debt once with a new source version', async () => {
    const input = await baseInput();
    const { expense } = await runInTx(undefined, tx => submitExpense(tx, input, '', fixture().submitter.id));
    createdExpenseIds.push(expense.id);
    const changed = await runInTx(undefined, tx => updateExpense(tx, expense.id, { amount: '456000' }, expense.updatedAt, fixture().submitter.id, true));
    assert.equal(changed.amount, '456000');
    assert.ok(changed.updatedAt.getTime() > expense.updatedAt.getTime());
    const entries = await db.select().from(s.ledger).where(and(eq(s.ledger.entityType, 'VENDOR'), eq(s.ledger.entityId, input.supplierId)));
    assert.equal(entries.length, 3);
    assert.equal(entries.reduce((total, row) => total + Number(row.credit) - Number(row.debit), 0), 456000);
    await assert.rejects(() => runInTx(undefined, tx => updateExpense(tx, expense.id, { amount: '789000' }, expense.updatedAt, fixture().submitter.id, true)), /người khác cập nhật/);
  });
  test('partial payment prevents amount changes and deletion until its allocation is reversed', async () => {
    const input = await baseInput();
    const { expense } = await runInTx(undefined, tx => submitExpense(tx, input, '', fixture().submitter.id));
    createdExpenseIds.push(expense.id);
    await runInTx(undefined, tx => settleExpensesForPayment({ allocations: [{ expenseId: expense.id, amount: 50000 }], supplierId: expense.supplierId, paymentLedgerId: 9303, paymentAmount: 50000, transaction: tx }));
    const [partial] = await db.select().from(s.expenses).where(eq(s.expenses.id, expense.id));
    assert.equal(partial.paymentStatus, 'UNPAID');
    await assert.rejects(() => runInTx(undefined, tx => updateExpense(tx, expense.id, { amount: '40000' }, partial.updatedAt, fixture().submitter.id, true)), /thanh toán một phần/);
    await assert.rejects(() => runInTx(undefined, tx => deleteExpense(tx, expense.id, partial.updatedAt, fixture().submitter.id, true)), /thanh toán một phần/);
    assert.equal(await ledgerCount(input.supplierId), 1);
  });

  test('direct financial action wrapper persists before after delta audit and rejects a stale expense correction', async () => {
    const input = await baseInput();
    const actor = fixture().submitter;
    const { expense } = await runInTx(undefined, tx => submitExpense(tx, input, '', actor.id));
    createdExpenseIds.push(expense.id);
    const apply = () => autoApplyGovernanceAction({
      make: tx => requestCompanyExpenseGovernance({ expenseId: expense.id, expectedUpdatedAt: expense.updatedAt, reason: 'Correct invoice amount', makerId: actor.id, makerRole: actor.role, mutation: 'UPDATE', patch: { amount: '456000' }, transaction: tx }),
      apply: applyCompanyExpenseGovernanceAction, actorId: actor.id, actorRole: actor.role,
    });
    await apply();
    const audits = await db.select().from(s.auditLogs).where(and(eq(s.auditLogs.userId, actor.id), eq(s.auditLogs.entityId, expense.id), eq(s.auditLogs.entityType, 'financial-action')));
    assert.equal(audits.length, 1);
    const payload = audits[0].payload!;
    assert.equal(payload.event, 'FINANCIAL_ACTION_APPLIED');
    assert.equal(payload.actionKind, 'COMPANY_EXPENSE');
    assert.equal(payload.actorId, actor.id);
    assert.equal((payload.beforeSnapshot as { amount: string }).amount, '123000');
    assert.equal((payload.afterSnapshot as { amount: string }).amount, '456000');
    assert.equal((payload.deltaSnapshot as { mutation: string }).mutation, 'UPDATE');
    const entries = await db.select().from(s.ledger).where(and(eq(s.ledger.entityType, 'VENDOR'), eq(s.ledger.entityId, input.supplierId)));
    assert.equal(entries.length, 3);
    assert.equal(entries.reduce((total, row) => total + Number(row.credit) - Number(row.debit), 0), 456000);
    await assert.rejects(apply, /người khác cập nhật/);
    const finalAudits = await db.select().from(s.auditLogs).where(and(eq(s.auditLogs.userId, actor.id), eq(s.auditLogs.entityId, expense.id), eq(s.auditLogs.entityType, 'financial-action')));
    assert.equal(finalAudits.length, 1, 'stale retry records neither an action nor another posting');
  });

});
