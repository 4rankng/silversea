import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import { createExpense } from '../services/expense.service';

const categoryName = `QA supplier validation ${Date.now()}`;
let categoryId: number | undefined;

after(async () => {
  if (categoryId !== undefined) {
    await db.delete(s.expenseCategories).where(eq(s.expenseCategories.id, categoryId));
  }
  await client.end();
});

describe('expense supplier validation', () => {
  test('rejects an unknown supplier before the database foreign-key boundary', async () => {
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
        && error.statusCode === 400
        && error.message === 'Nhà cung cấp không tồn tại'
      ),
    );
  });
});
