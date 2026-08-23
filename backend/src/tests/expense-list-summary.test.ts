import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';

import { db, client } from '../db';
import * as s from '../db/schema';
import { listExpenses, EXPENSE_LIST_SORT_KEYS } from '../services/expense.service';
import expenseRoutes from '../routes/expense';
import { globalErrorHandler } from '../middleware/errorHandler';

// List envelope carries full-set payment-status aggregates so the page's KPI
// strip never derives headline numbers from the loaded page.
const marker = `QA list summary ${Date.now()}`;
let supplierId: number | undefined;
let categoryId: number | undefined;
const expenseIds: number[] = [];

async function seedExpense(amount: string, paymentStatus: string, expenseDate: string) {
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

describe('listExpenses summary aggregates', () => {
  test('summary is full-set across pages and respects date filters', async () => {
    const [supplier] = await db.insert(s.suppliers).values({
      name: `${marker} supplier`,
      status: 'ACTIVE',
    }).returning({ id: s.suppliers.id });
    supplierId = supplier.id;

    const [category] = await db.insert(s.expenseCategories).values({
      name: `${marker} category`,
    }).returning({ id: s.expenseCategories.id });
    categoryId = category.id;

    // 3 PAID + 2 UNPAID in July, 1 UNPAID in August.
    await seedExpense('100000', 'PAID', '2026-07-01');
    await seedExpense('200000', 'PAID', '2026-07-02');
    await seedExpense('50000', 'PAID', '2026-07-03');
    await seedExpense('300000', 'UNPAID', '2026-07-04');
    await seedExpense('70000', 'UNPAID', '2026-07-05');
    await seedExpense('90000', 'UNPAID', '2026-08-01');

    // Page size 2: summary must describe all filtered rows, not the page.
    const page1 = await listExpenses(db, {
      supplierId,
      fromDate: '2026-07-01',
      toDate: '2026-07-31',
      page: 1,
      pageSize: 2,
    });
    assert.equal(page1.total, 5);
    assert.equal(page1.items.length, 2);
    assert.equal(page1.summary.paidCount, 3);
    assert.equal(page1.summary.unpaidCount, 2);
    assert.equal(page1.summary.paidAmount, 350000);
    assert.equal(page1.summary.unpaidAmount, 370000);
    assert.equal(page1.summary.totalAmount, 720000);

    // Same summary on page 2 — page-independent.
    const page2 = await listExpenses(db, {
      supplierId,
      fromDate: '2026-07-01',
      toDate: '2026-07-31',
      page: 2,
      pageSize: 2,
    });
    assert.deepEqual(page2.summary, page1.summary);

    // Widening the window changes the summary with it.
    const wide = await listExpenses(db, {
      supplierId,
      fromDate: '2026-07-01',
      toDate: '2026-08-31',
      page: 1,
      pageSize: 2,
    });
    assert.equal(wide.summary.unpaidCount, 3);
    assert.equal(wide.summary.unpaidAmount, 460000);
  });
});

describe('GET /api/expenses sort params at the route boundary', () => {
  // Service-level sort behavior (defaults, numeric ordering, status rank)
  // lives in expense-list-sort.test.ts; this suite pins the HTTP 400 on an
  // unwhitelisted sortBy/sortDir.
  let server: http.Server;
  let baseUrl: string;

  before(async () => {
    const app = express();
    app.use('/api/expenses', expenseRoutes);
    app.use(globalErrorHandler);
    await new Promise<void>((resolve) => {
      server = http.createServer(app);
      server.listen(0, () => {
        baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  });

  test('rejects an unknown sortBy with 400 and accepts the whitelisted vocabulary', async () => {
    const invalid = await fetch(`${baseUrl}/api/expenses?sortBy=bogus`);
    assert.equal(invalid.status, 400);

    const invalidDir = await fetch(`${baseUrl}/api/expenses?sortBy=amount&sortDir=up`);
    assert.equal(invalidDir.status, 400);

    const valid = await fetch(`${baseUrl}/api/expenses?sortBy=${EXPENSE_LIST_SORT_KEYS[0]}&sortDir=desc&limit=1`);
    assert.equal(valid.status, 200);
    const body = await valid.json() as { items: unknown[]; total: number };
    assert.ok(Array.isArray(body.items));
    assert.equal(typeof body.total, 'number');
  });
});
