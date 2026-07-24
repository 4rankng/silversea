import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PayableSummary, Supplier } from '@tingting/shared';
import { mergePayablesSummaries } from '../services/aging.service';

function supplier(id: number, name: string): Supplier {
  return {
    id,
    name,
    contactPerson: null,
    phone: null,
    taxCode: null,
    note: null,
    status: 'ACTIVE',
    linkedCustomerId: null,
    isFuelSupplier: false,
    createdAt: '',
    updatedAt: '',
    deletedAt: null,
  };
}

function item(
  id: number,
  name: string,
  totalOutstanding: number,
  kind: NonNullable<PayableSummary['kind']>,
): PayableSummary {
  return {
    supplier: supplier(id, name),
    totalOutstanding,
    aging: { current: totalOutstanding, d30: 0, d60: 0, over90: 0 },
    maxOverdueDays: 10,
    kind,
  };
}

describe('mergePayablesSummaries', () => {
  test('the all-category result includes vendor and outsourced-carrier payables', () => {
    const merged = mergePayablesSummaries([
      {
        items: [item(1, 'Nhà cung cấp A', 12_000_000, 'vendor')],
        totalOutstanding: 12_000_000,
        totalSuppliers: 1,
        overdueSuppliers: 0,
      },
      {
        items: [item(9, 'Đội xe thuê ngoài', 30_000_000, 'carrier')],
        totalOutstanding: 30_000_000,
        totalSuppliers: 1,
        overdueSuppliers: 1,
      },
    ]);

    assert.equal(merged.totalOutstanding, 42_000_000);
    assert.equal(merged.totalSuppliers, 2);
    assert.equal(merged.overdueSuppliers, 1);
    assert.deepEqual(merged.items.map(row => row.kind), ['carrier', 'vendor']);
  });
});
