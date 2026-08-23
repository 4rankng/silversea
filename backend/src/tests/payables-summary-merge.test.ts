import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PayableSummary, Supplier } from '@tingting/shared';
import { mergePayablesSummaries, paginatePayablesSummary } from '../services/aging.service';

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

describe('paginatePayablesSummary sortBy/sortDir (GET /reports/payables-summary)', () => {
  function result(items: PayableSummary[]) {
    return {
      items,
      totalOutstanding: items.reduce((sum, r) => sum + r.totalOutstanding, 0),
      totalSuppliers: items.length,
      overdueSuppliers: 0,
    };
  }

  // The rest of the sort contract (defaults, collation, numeric keys, kind
  // tiebreakers, whitelist rejection) lives in aging-sort.test.ts.
  test('keeps null supplier names last in both directions', () => {
    const rows = [
      item(3, 'NCC Việt Nhật', 25_000_000, 'vendor'),
      item(1, 'NCC Ánh Dương', 80_000_000, 'vendor'),
    ];
    const nullName = { ...item(5, 'NCC Không Tên', 10_000_000, 'vendor'), supplier: supplier(5, null as unknown as string) };
    const withNull = [...rows, nullName];

    const asc = paginatePayablesSummary(result(withNull), { sortBy: 'supplierName', sortDir: 'asc', page: 1, limit: 10 });
    assert.equal(asc.items[asc.items.length - 1]!.supplier.name, null);

    const desc = paginatePayablesSummary(result(withNull), { sortBy: 'supplierName', sortDir: 'desc', page: 1, limit: 10 });
    assert.equal(desc.items[desc.items.length - 1]!.supplier.name, null);
  });
});
