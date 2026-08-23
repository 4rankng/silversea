import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PayableSummary, Supplier } from '@tingting/shared';
import {
  CUSTOMER_AGING_SORT_KEYS,
  PAYABLES_SUMMARY_SORT_KEYS,
  customerAgingSortQuerySchema,
  mergePayablesSummaries,
  paginatePayablesSummary,
  payablesSummarySortQuerySchema,
  sortCustomerAgingRows,
  type CustomerAgingListItem,
  type CustomerAgingSortKey,
  type PayablesSummarySortKey,
} from '../services/aging.service';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function agingRow(
  customerId: number,
  customerName: string,
  values: { totalOutstanding: number; netBalance?: number; maxOverdueDays?: number },
): CustomerAgingListItem {
  return {
    customerId,
    customerName,
    contactInfo: null,
    linkedSupplierId: null,
    linkedSupplierApBalance: 0,
    netBalance: values.netBalance ?? values.totalOutstanding,
    totalOutstanding: values.totalOutstanding,
    aging: { current: values.totalOutstanding, d30: 0, d60: 0, over90: 0 },
    maxOverdueDays: values.maxOverdueDays ?? 0,
  };
}

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

function payable(
  id: number,
  name: string,
  aging: { current: number; d30?: number; d60?: number; over90?: number },
  kind: 'vendor' | 'carrier' = 'vendor',
): PayableSummary {
  const totalOutstanding = aging.current + (aging.d30 ?? 0) + (aging.d60 ?? 0) + (aging.over90 ?? 0);
  return {
    supplier: supplier(id, name),
    totalOutstanding,
    aging: { current: aging.current, d30: aging.d30 ?? 0, d60: aging.d60 ?? 0, over90: aging.over90 ?? 0 },
    maxOverdueDays: 0,
    kind,
  };
}

function sortedBy<T>(rows: T[], mutate: (rows: T[]) => void): T[] {
  const copy = [...rows];
  mutate(copy);
  return copy;
}

function ids(rows: Array<{ customerId: number }>): number[] {
  return rows.map(r => r.customerId);
}

// ─── Receivables aging list (GET /reports/receivables-aging) ─────────────────

describe('sortCustomerAgingRows', () => {
  const rows = [
    agingRow(1, 'Công ty An Phát', { totalOutstanding: 5_000_000, netBalance: 2_000_000, maxOverdueDays: 12 }),
    agingRow(2, 'Zeta Logistics', { totalOutstanding: 30_000_000, netBalance: -4_000_000, maxOverdueDays: 75 }),
    agingRow(3, 'Ánh Minh', { totalOutstanding: 12_000_000, netBalance: 9_000_000, maxOverdueDays: 40 }),
  ];

  it('keeps the historical outstanding-desc default when sort params are absent', () => {
    const sorted = sortedBy(rows, copy => sortCustomerAgingRows(copy));
    assert.deepEqual(ids(sorted), [2, 3, 1]);
  });

  it('sorts totalOutstanding numerically asc and desc (not by formatted string)', () => {
    const asc = sortedBy(rows, copy => sortCustomerAgingRows(copy, 'totalOutstanding', 'asc'));
    assert.deepEqual(asc.map(r => r.totalOutstanding), [5_000_000, 12_000_000, 30_000_000]);

    const desc = sortedBy(rows, copy => sortCustomerAgingRows(copy, 'totalOutstanding', 'desc'));
    assert.deepEqual(desc.map(r => r.totalOutstanding), [30_000_000, 12_000_000, 5_000_000]);
  });

  it('sorts customerName with Vietnamese collation in both directions', () => {
    const asc = sortedBy(rows, copy => sortCustomerAgingRows(copy, 'customerName', 'asc'));
    // 'Ánh Minh' sorts as "Anh" (tone-insensitive) before "Công ty" before "Zeta".
    assert.deepEqual(asc.map(r => r.customerName), ['Ánh Minh', 'Công ty An Phát', 'Zeta Logistics']);

    const desc = sortedBy(rows, copy => sortCustomerAgingRows(copy, 'customerName', 'desc'));
    assert.deepEqual(desc.map(r => r.customerName), ['Zeta Logistics', 'Công ty An Phát', 'Ánh Minh']);
  });

  it('sorts netBalance and maxOverdueDays asc/desc including negative values', () => {
    const netAsc = sortedBy(rows, copy => sortCustomerAgingRows(copy, 'netBalance', 'asc'));
    assert.deepEqual(netAsc.map(r => r.netBalance), [-4_000_000, 2_000_000, 9_000_000]);

    const overdueDesc = sortedBy(rows, copy => sortCustomerAgingRows(copy, 'maxOverdueDays', 'desc'));
    assert.deepEqual(overdueDesc.map(r => r.maxOverdueDays), [75, 40, 12]);
  });

  it('breaks ties on customerId ascending regardless of direction', () => {
    const tied = [
      agingRow(7, 'B', { totalOutstanding: 10 }),
      agingRow(2, 'A', { totalOutstanding: 10 }),
      agingRow(5, 'C', { totalOutstanding: 10 }),
    ];
    const desc = sortedBy(tied, copy => sortCustomerAgingRows(copy, 'totalOutstanding', 'desc'));
    assert.deepEqual(ids(desc), [2, 5, 7]);
    const asc = sortedBy(tied, copy => sortCustomerAgingRows(copy, 'totalOutstanding', 'asc'));
    assert.deepEqual(ids(asc), [2, 5, 7]);
  });
});

// ─── Payables summary list (GET /reports/payables-summary) ───────────────────

describe('payables summary sorting', () => {
  const items = [
    payable(1, 'Xăng dầu Petrolimex', { current: 4_000_000, d30: 6_000_000 }),
    payable(2, 'An Cường', { current: 15_000_000 }),
    payable(9, 'Đội xe Bắc', { current: 0, over90: 20_000_000 }, 'carrier'),
  ];
  // Production precondition: getPayablesSummary hands paginatePayablesSummary a
  // mergePayablesSummaries result, i.e. items already in outstanding-desc order.
  const summary = mergePayablesSummaries([
    { items, totalOutstanding: 45_000_000, totalSuppliers: 3, overdueSuppliers: 1 },
  ]);

  it('keeps the merge order (outstanding desc) when sort params are absent', () => {
    const page = paginatePayablesSummary(summary, {});
    assert.deepEqual(page.items.map(d => d.supplier.id), [9, 2, 1]);
  });

  it('sorts supplierName asc and desc through the pagination envelope', () => {
    const asc = paginatePayablesSummary(summary, { sortBy: 'supplierName', sortDir: 'asc' });
    assert.deepEqual(asc.items.map(d => d.supplier.name), ['An Cường', 'Đội xe Bắc', 'Xăng dầu Petrolimex']);

    const desc = paginatePayablesSummary(summary, { sortBy: 'supplierName', sortDir: 'desc' });
    assert.deepEqual(desc.items.map(d => d.supplier.name), ['Xăng dầu Petrolimex', 'Đội xe Bắc', 'An Cường']);
  });

  it('sorts totalOutstanding and the aging buckets numerically in both directions', () => {
    const totalAsc = paginatePayablesSummary(summary, { sortBy: 'totalOutstanding', sortDir: 'asc' });
    assert.deepEqual(totalAsc.items.map(d => d.totalOutstanding), [10_000_000, 15_000_000, 20_000_000]);

    const totalDesc = paginatePayablesSummary(summary, { sortBy: 'totalOutstanding', sortDir: 'desc' });
    assert.deepEqual(totalDesc.items.map(d => d.totalOutstanding), [20_000_000, 15_000_000, 10_000_000]);

    const d30Desc = paginatePayablesSummary(summary, { sortBy: 'd30', sortDir: 'desc' });
    assert.deepEqual(d30Desc.items.map(d => d.aging.d30), [6_000_000, 0, 0]);

    const over90Asc = paginatePayablesSummary(summary, { sortBy: 'over90', sortDir: 'asc' });
    assert.deepEqual(over90Asc.items.map(d => d.aging.over90), [0, 0, 20_000_000]);
  });

  it('applies the sort to the searched set and slices the sorted page window', () => {
    const many = [
      payable(1, 'Alpha', { current: 1_000_000 }),
      payable(2, 'Beta Alpha', { current: 9_000_000 }),
      payable(3, 'Gamma', { current: 5_000_000 }),
    ];
    const full = { items: many, totalOutstanding: 15_000_000, totalSuppliers: 3, overdueSuppliers: 0 };

    const page = paginatePayablesSummary(full, { search: 'alpha', sortBy: 'totalOutstanding', sortDir: 'asc', page: 1, limit: 1 });
    assert.deepEqual(page.items.map(d => d.supplier.id), [1]);
    assert.equal(page.total, 2);
    assert.equal(page.totalPages, 2);
  });

  it('breaks ties vendor-before-carrier, then supplier id ascending', () => {
    const tied = [
      payable(11, 'Nhà xe Nam', { current: 1_000 }, 'carrier'),
      payable(3, 'Vendor B', { current: 1_000 }),
      payable(2, 'Vendor A', { current: 1_000 }),
    ];
    const page = paginatePayablesSummary(
      { items: tied, totalOutstanding: 3_000, totalSuppliers: 3, overdueSuppliers: 0 },
      { sortBy: 'current', sortDir: 'desc' },
    );
    assert.deepEqual(page.items.map(d => `${d.kind}-${d.supplier.id}`), ['vendor-2', 'vendor-3', 'carrier-11']);
  });
});

// ─── Query-param whitelists ──────────────────────────────────────────────────

describe('aging sort query schemas', () => {
  it('accepts every advertised sort key plus both directions', () => {
    for (const sortBy of CUSTOMER_AGING_SORT_KEYS) {
      assert.equal(customerAgingSortQuerySchema.safeParse({ sortBy, sortDir: 'asc' }).success, true);
      assert.equal(customerAgingSortQuerySchema.safeParse({ sortBy, sortDir: 'desc' }).success, true);
    }
    for (const sortBy of PAYABLES_SUMMARY_SORT_KEYS) {
      assert.equal(payablesSummarySortQuerySchema.safeParse({ sortBy, sortDir: 'asc' }).success, true);
      assert.equal(payablesSummarySortQuerySchema.safeParse({ sortBy, sortDir: 'desc' }).success, true);
    }
  });

  it('accepts absent sort params and rejects unknown keys or directions', () => {
    assert.equal(customerAgingSortQuerySchema.safeParse({}).success, true);
    assert.equal(payablesSummarySortQuerySchema.safeParse({}).success, true);

    assert.equal(customerAgingSortQuerySchema.safeParse({ sortBy: 'contactInfo' }).success, false);
    assert.equal(payablesSummarySortQuerySchema.safeParse({ sortBy: 'supplierName', sortDir: 'ASC' }).success, false);
  });

  it('advertises exactly the sortable data columns of both screens', () => {
    assert.deepEqual([...CUSTOMER_AGING_SORT_KEYS], ['customerName', 'totalOutstanding', 'netBalance', 'maxOverdueDays'] satisfies CustomerAgingSortKey[]);
    assert.deepEqual([...PAYABLES_SUMMARY_SORT_KEYS], ['supplierName', 'totalOutstanding', 'current', 'd30', 'd60', 'over90'] satisfies PayablesSummarySortKey[]);
  });
});
