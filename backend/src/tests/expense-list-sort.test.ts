import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { listExpenses } from '../services/expense.service';

// Column sorting for the expense ledger: whitelisted sortBy keys, numeric
// money ordering, status rank, and an unchanged default order when the sort
// params are absent.
const marker = `QA list sort ${Date.now()}`;
let supplierId: number | undefined;
let categoryId: number | undefined;
const expenseIds: number[] = [];

// Amounts are chosen so lexicographic and numeric order differ: numeric asc is
// 50k, 90k, 300k, 700k while a string sort would yield 300000, 50000, 700000,
// 90000. Dates run opposite to amounts so date sorting can't mask as amount
// sorting (and vice versa).
async function seedExpense(amount: string, paymentStatus: string, expenseDate: string): Promise<void> {
  const [row] = await db.insert(s.expenses).values({
    expenseDate,
    supplierId: supplierId!,
    categoryId: categoryId!,
    amount,
    paymentStatus,
    note: marker,
  }).returning({ id: s.expenses.id });
  expenseIds.push(row.id);
}

after(async () => {
  if (expenseIds.length > 0) {
    await db.delete(s.expenses).where(inArray(s.expenses.id, expenseIds));
  }
  if (supplierId !== undefined) {
    await db.delete(s.suppliers).where(eq(s.suppliers.id, supplierId));
  }
  if (categoryId !== undefined) {
    await db.delete(s.expenseCategories).where(eq(s.expenseCategories.id, categoryId));
  }
  await client.end();
});

describe('listExpenses column sorting', () => {
  test('sorts amount numerically in both directions, status by attention rank', async () => {
    const [supplier] = await db.insert(s.suppliers).values({
      name: `${marker} supplier`,
      status: 'ACTIVE',
    }).returning({ id: s.suppliers.id });
    supplierId = supplier.id;

    const [category] = await db.insert(s.expenseCategories).values({
      name: `${marker} category`,
    }).returning({ id: s.expenseCategories.id });
    categoryId = category.id;

    await seedExpense('90000', 'UNPAID', '2026-07-01');
    await seedExpense('700000', 'PAID', '2026-07-02');
    await seedExpense('300000', 'UNPAID', '2026-07-03');
    await seedExpense('50000', 'PAID', '2026-07-04');

    // Absent sort params reproduce the default newest-first order exactly.
    const defaultOrder = await listExpenses(db, {
      supplierId,
      page: 1,
      pageSize: 10,
    });
    assert.deepEqual(
      defaultOrder.items.map(item => item.expenseDate),
      ['2026-07-04', '2026-07-03', '2026-07-02', '2026-07-01'],
    );

    // Numeric asc: 50k < 90k < 300k < 700k (lexicographic would disagree).
    const amountAsc = await listExpenses(db, {
      supplierId,
      page: 1,
      pageSize: 10,
      sortBy: 'amount',
      sortDir: 'asc',
    });
    assert.deepEqual(
      amountAsc.items.map(item => Number(item.amount)),
      [50_000, 90_000, 300_000, 700_000],
    );

    const amountDesc = await listExpenses(db, {
      supplierId,
      page: 1,
      pageSize: 10,
      sortBy: 'amount',
      sortDir: 'desc',
    });
    assert.deepEqual(
      amountDesc.items.map(item => Number(item.amount)),
      [700_000, 300_000, 90_000, 50_000],
    );

    // Status rank puts UNPAID (needs attention) before PAID on asc — the
    // enum's alphabetical order ('PAID' < 'UNPAID') must NOT apply.
    const statusAsc = await listExpenses(db, {
      supplierId,
      page: 1,
      pageSize: 10,
      sortBy: 'paymentStatus',
      sortDir: 'asc',
    });
    assert.deepEqual(
      statusAsc.items.map(item => item.paymentStatus),
      ['UNPAID', 'UNPAID', 'PAID', 'PAID'],
    );

    // Date asc is the exact reverse of the default order here (distinct dates).
    const dateAsc = await listExpenses(db, {
      supplierId,
      page: 1,
      pageSize: 10,
      sortBy: 'expenseDate',
      sortDir: 'asc',
    });
    assert.deepEqual(
      dateAsc.items.map(item => item.expenseDate),
      ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04'],
    );
  });
});
