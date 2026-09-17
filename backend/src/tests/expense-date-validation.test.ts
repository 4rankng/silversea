// Expense dates must be rejected at the schema layer with Vietnamese messages —
// garbage or impossible dates must never reach Postgres (which currently
// surfaces as a 500 with the raw INSERT in the dev error details).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expenseSchema } from '@tingting/shared';

const BASE = {
  supplierId: 1,
  categoryId: 1,
  amount: 1000,
  paymentStatus: 'UNPAID',
};

test('POST shape: garbage expenseDate is rejected with the format message', () => {
  const parsed = expenseSchema.safeParse({ ...BASE, expenseDate: 'not-a-date' });
  assert.equal(parsed.success, false);
  if (parsed.success) return;
  assert.equal(parsed.error.issues[0].path[0], 'expenseDate');
  assert.equal(parsed.error.issues[0].message, 'Ngày phải có định dạng YYYY-MM-DD');
});

test('POST shape: impossible expenseDate 2026-02-30 is rejected as nonexistent', () => {
  const parsed = expenseSchema.safeParse({ ...BASE, expenseDate: '2026-02-30' });
  assert.equal(parsed.success, false);
  if (parsed.success) return;
  assert.equal(parsed.error.issues[0].message, 'Ngày không tồn tại');
});

test('POST shape: a valid date still parses', () => {
  const parsed = expenseSchema.safeParse({ ...BASE, expenseDate: '2026-09-15' });
  assert.equal(parsed.success, true);
});

test('validFrom/validTo: garbage rejected, empty string clears to null, valid passes', () => {
  const bad = expenseSchema.safeParse({ ...BASE, expenseDate: '2026-09-15', validFrom: 'garbage' });
  assert.equal(bad.success, false);
  if (!bad.success) assert.equal(bad.error.issues[0].path[0], 'validFrom');

  const cleared = expenseSchema.safeParse({ ...BASE, expenseDate: '2026-09-15', validFrom: '', validTo: '' });
  assert.equal(cleared.success, true);
  if (cleared.success) {
    assert.equal(cleared.data.validFrom, null);
    assert.equal(cleared.data.validTo, null);
  }

  const good = expenseSchema.safeParse({
    ...BASE,
    expenseDate: '2026-09-15',
    validFrom: '2026-09-01',
    validTo: '2026-09-30',
  });
  assert.equal(good.success, true);
});

test('PUT shape (schema.partial()): partial garbage expenseDate is still rejected', () => {
  const parsed = expenseSchema.partial().safeParse({ expenseDate: 'not-a-date' });
  assert.equal(parsed.success, false);
  if (parsed.success) return;
  assert.equal(parsed.error.issues[0].message, 'Ngày phải có định dạng YYYY-MM-DD');
});
