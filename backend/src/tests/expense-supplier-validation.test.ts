import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import { createExpense, updateExpense } from '../services/expense.service';

const categoryName = `QA supplier validation ${Date.now()}`;
let categoryId: number | undefined;
let supplierId: number | undefined;
let expenseId: number | undefined;

after(async () => {
  if (expenseId !== undefined) {
    await db.delete(s.expenses).where(eq(s.expenses.id, expenseId));
  }
  if (supplierId !== undefined) {
    await db.delete(s.suppliers).where(eq(s.suppliers.id, supplierId));
  }
  if (categoryId !== undefined) {
    await db.delete(s.expenseCategories).where(eq(s.expenseCategories.id, categoryId));
  }
  await client.end();
});

describe('expense service governance boundary', () => {
  test('rejects direct create calls before any database write', async () => {
    const [category] = await db.insert(s.expenseCategories)
      .values({ name: categoryName })
      .returning({ id: s.expenseCategories.id });
    categoryId = category.id;

    await assert.rejects(
      db.transaction((tx) => createExpense(tx, {
        expenseDate: '2026-07-26',
        supplierId: 2_147_483_647,
        categoryId: category.id,
        amount: '100000',
        paymentStatus: 'PAID',
      })),
      (error: unknown) => (
        error instanceof ApiError
        && error.statusCode === 403
        && /chỉ được ghi nhận sau khi hoàn tất phê duyệt/i.test(error.message)
      ),
    );
  });

  test('rejects a direct financially material update while allowing note-only edits', async () => {
    const [supplier] = await db.insert(s.suppliers)
      .values({ name: `${categoryName} supplier` })
      .returning({ id: s.suppliers.id });
    supplierId = supplier.id;
    const created = await db.transaction((tx) => createExpense(tx, {
      expenseDate: '2026-07-26',
      supplierId: supplier.id,
      categoryId: categoryId!,
      amount: '100000',
      paymentStatus: 'PAID',
      note: 'Phiếu đã quyết toán',
    }, undefined, true));
    expenseId = created.id;

    await assert.rejects(
      db.transaction((tx) => updateExpense(
        tx,
        created.id,
        { amount: '120000' },
        created.updatedAt,
      )),
      (error: unknown) => (
        error instanceof ApiError
        && error.statusCode === 403
        && /chỉ được áp dụng sau phê duyệt/i.test(error.message)
      ),
    );

    const updated = await db.transaction((tx) => updateExpense(
      tx,
      created.id,
      { note: 'Bổ sung ghi chú không tài chính' },
      created.updatedAt,
    ));
    assert.equal(updated.note, 'Bổ sung ghi chú không tài chính');
    assert.equal(updated.amount, '100000');
  });
});
