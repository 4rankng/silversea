import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPENSE_FEE_GROUP_LABELS,
  OPS_EXPENSE_TYPE_DEFAULTS,
  ExpenseTypeCategory,
  expenseFeeGroupOf,
} from '@tingting/shared';
import { expenseTypeSeedPolicy } from '../expense-type-seed-policy';

// Card 20260921_4 — the chi-hộ fee catalog: the customer's fee list seeded as
// DATA, grouped Nâng / Hạ / Phí khác from the settlement category (never the
// name), all invoice-bearing (default-collectible from the customer).

describe('card 20260921_4 — chi-hộ fee catalog', () => {
  test('the customer fee list exists as catalog data with categories', () => {
    const expected: Array<[string, string, string]> = [
      ['LIFT_EMPTY', 'Phí nâng vỏ', 'LIFT'],
      ['LIFT_CARGO', 'Phí nâng hàng', 'LIFT'],
      ['YARD_STORAGE', 'Phí lưu bãi', 'DROP'],
      ['LOWER_EMPTY', 'Phí hạ vỏ', 'DROP'],
      ['LOWER_CARGO', 'Phí hạ hàng', 'DROP'],
      ['CONTAINER_DEMURRAGE', 'Phí lưu vỏ', 'DROP'],
      ['FEE_EXTENSION', 'Phí gia hạn', 'KHAC'],
      ['FEE_CLEANING', 'Phí vệ sinh', 'KHAC'],
      ['FEE_SCANNING', 'Phí soi chiếu', 'KHAC'],
      ['FEE_STEVEDORING', 'Phí bốc xếp', 'KHAC'],
      ['FEE_LABOR', 'Phí công nhân', 'KHAC'],
      ['FEE_WAREHOUSE', 'Phí lưu kho', 'KHAC'],
    ];
    for (const [code, name, category] of expected) {
      const row = OPS_EXPENSE_TYPE_DEFAULTS[code];
      assert.ok(row, `catalog carries ${code}`);
      assert.equal(row.name, name);
      assert.equal(row.category, category);
    }
  });

  test('every chi-hộ fee is invoice-bearing (default-thu via the create path)', () => {
    const chiHoCodes = [
      'LIFT_EMPTY', 'LIFT_CARGO', 'LOWER_EMPTY', 'LOWER_CARGO', 'YARD_STORAGE',
      'CONTAINER_DEMURRAGE', 'FEE_EXTENSION', 'FEE_CLEANING', 'FEE_SCANNING',
      'FEE_STEVEDORING', 'FEE_LABOR', 'FEE_WAREHOUSE',
    ];
    for (const code of chiHoCodes) {
      assert.equal(expenseTypeSeedPolicy(code).requiresInvoice, true, `${code} must require an invoice`);
    }
  });

  test('fee groups derive from the category, not the name', () => {
    assert.equal(expenseFeeGroupOf('LIFT'), 'LIFT');
    assert.equal(expenseFeeGroupOf('DROP'), 'DROP');
    assert.equal(expenseFeeGroupOf('HQGS'), 'OTHER');
    assert.equal(expenseFeeGroupOf('KHAC'), 'OTHER');
    assert.equal(expenseFeeGroupOf(null), 'OTHER');
    assert.equal(expenseFeeGroupOf(undefined), 'OTHER');
    assert.equal(EXPENSE_FEE_GROUP_LABELS.LIFT, 'Nâng');
    assert.equal(EXPENSE_FEE_GROUP_LABELS.DROP, 'Hạ');
    assert.equal(EXPENSE_FEE_GROUP_LABELS.OTHER, 'Phí khác');
    void ExpenseTypeCategory;
  });
});
