// The expense future-date guard must use the Vietnam calendar
// (Asia/Ho_Chi_Minh): at 17:30Z (already 00:30+07 of the NEXT VN day),
// VN-today must be accepted and the true future still rejected. Before the
// fix the guard measured end-of-today in the SERVER timezone, so a UTC
// server rejected VN-today during 17:00Z–24:00Z.
import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { db, client } from '../db';
import { todayIsoVn } from '../lib/vn-date';
import { submitExpense, type ExpenseCreateInput } from '../services/expense.service';
import type { Tx } from '../services/trip-shared';

class Rollback extends Error {}

async function inRolledBackTx(run: (tx: Tx) => Promise<void>): Promise<void> {
  await db.transaction(async (tx) => {
    await run(tx);
    throw new Rollback();
  }).catch((e) => {
    if (!(e instanceof Rollback)) throw e;
  });
}

const BASE = {
  supplierId: 1,
  categoryId: 1,
  amount: '1000',
  paymentStatus: 'UNPAID',
  validFrom: '2026-09-01',
  validTo: '2026-10-01',
};

const FROZEN_NOW = Date.parse('2026-09-15T17:30:00Z'); // 00:30+07 on 2026-09-16

test('todayIsoVn rolls over at 17:00Z to the next VN day', () => {
  assert.equal(todayIsoVn(new Date('2026-09-15T17:30:00Z')), '2026-09-16');
  assert.equal(todayIsoVn(new Date('2026-09-15T16:59:00Z')), '2026-09-15');
});

test('expenseDate = VN-today is accepted at 17:30Z (was rejected pre-fix)', async () => {
  mock.timers.enable({ apis: ['Date'], now: FROZEN_NOW });
  try {
    await inRolledBackTx(async (tx) => {
      await submitExpense(tx, { ...BASE, expenseDate: '2026-09-16' } as ExpenseCreateInput, 'QA25 vn-today', 1);
    });
  } finally {
    mock.timers.reset();
  }
});

test('true future date is still rejected at 17:30Z', async () => {
  mock.timers.enable({ apis: ['Date'], now: FROZEN_NOW });
  try {
    await assert.rejects(
      () => inRolledBackTx(async (tx) => {
        await submitExpense(tx, { ...BASE, expenseDate: '2026-09-17' } as ExpenseCreateInput, 'QA25 future', 1);
      }),
      /tương lai/,
    );
  } finally {
    mock.timers.reset();
  }
});

test('UTC-yesterday (VN-past) still accepted at 17:30Z', async () => {
  mock.timers.enable({ apis: ['Date'], now: FROZEN_NOW });
  try {
    await inRolledBackTx(async (tx) => {
      await submitExpense(tx, { ...BASE, expenseDate: '2026-09-15' } as ExpenseCreateInput, 'QA25 past', 1);
    });
  } finally {
    mock.timers.reset();
  }
});

test.after(async () => {
  await client.end();
});
