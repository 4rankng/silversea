import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PayableSummary, Supplier } from '@tingting/shared';
import {
  classifyAgingRisk,
  filterAgingByBucket,
  summarizeAgingTotals,
  paginatePayablesSummary,
} from '../../services/aging.service';

const aging = (current: number, d30: number, d60: number, over90: number) => ({ current, d30, d60, over90 });

describe('classifyAgingRisk', () => {
  test('over90 balance or >100M outstanding is high risk', () => {
    assert.equal(classifyAgingRisk(5_000_000, aging(0, 0, 0, 1_000)), 'high');
    assert.equal(classifyAgingRisk(150_000_000, aging(150_000_000, 0, 0, 0)), 'high');
  });
  test('d30/d60 balance is medium; current-only is low', () => {
    assert.equal(classifyAgingRisk(5_000_000, aging(1_000, 500, 0, 0)), 'med');
    assert.equal(classifyAgingRisk(5_000_000, aging(1_000, 0, 200, 0)), 'med');
    assert.equal(classifyAgingRisk(5_000_000, aging(5_000_000, 0, 0, 0)), 'low');
  });
  test('non-positive outstanding is low', () => {
    assert.equal(classifyAgingRisk(0, aging(0, 0, 0, 0)), 'low');
  });
});

describe('filterAgingByBucket', () => {
  const rows = [
    { totalOutstanding: 100, aging: aging(100, 0, 0, 0) },
    { totalOutstanding: 200, aging: aging(0, 150, 0, 0) },
    { totalOutstanding: 300, aging: aging(0, 0, 300, 0) },
    { totalOutstanding: 400, aging: aging(0, 0, 0, 400) },
  ];
  test('all returns every row', () => {
    assert.equal(filterAgingByBucket(rows, 'all').length, 4);
  });
  for (const bucket of ['current', 'd30', 'd60', 'over90'] as const) {
    test(`${bucket} keeps only rows with that bucket and outstanding`, () => {
      const kept = filterAgingByBucket(rows, bucket);
      assert.equal(kept.length, 1);
      assert.ok(kept[0].aging[bucket] > 0);
    });
  }
  test('zero-outstanding rows are excluded from every named bucket', () => {
    const zero = [{ totalOutstanding: 0, aging: aging(5, 0, 0, 0) }];
    assert.equal(filterAgingByBucket(zero, 'current').length, 0);
  });
});

describe('summarizeAgingTotals', () => {
  test('aggregates sums and per-bucket customer counts over the full set', () => {
    const totals = summarizeAgingTotals([
      { totalOutstanding: 100, maxOverdueDays: 5, aging: aging(100, 0, 0, 0) },
      { totalOutstanding: 200, maxOverdueDays: 45, aging: aging(50, 150, 0, 0) },
      { totalOutstanding: 400, maxOverdueDays: 120, aging: aging(0, 0, 0, 400) },
      { totalOutstanding: 0, maxOverdueDays: 0, aging: aging(0, 0, 0, 0) },
    ]);
    assert.equal(totals.total, 700);
    assert.equal(totals.current, 150);
    assert.equal(totals.d30, 150);
    assert.equal(totals.over90, 400);
    assert.equal(totals.currentCusts, 2);
    assert.equal(totals.d30Custs, 1);
    assert.equal(totals.over90Custs, 1);
    assert.equal(totals.overdueCount, 2); // maxOverdueDays > 30
    assert.equal(totals.highRiskCount, 1); // over90 balance
  });
});

describe('paginatePayablesSummary', () => {
  const supplier = (id: number, name: string, phone?: string): Supplier => ({
    id,
    name,
    contactPerson: null,
    phone: phone ?? null,
    taxCode: null,
    note: null,
    status: 'ACTIVE',
    linkedCustomerId: null,
    isFuelSupplier: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
  });
  const mk = (id: number, name: string, outstanding: number): PayableSummary => ({
    supplier: supplier(id, name),
    totalOutstanding: outstanding,
    aging: aging(outstanding, 0, 0, 0),
    maxOverdueDays: 0,
    kind: 'vendor',
  });

  test('paginates, keeps full-set headline numbers, and aggregates totals', () => {
    const result = {
      items: [mk(1, 'Alpha Fuel', 300), mk(2, 'Beta Logistics', 200), mk(3, 'Gamma', 100)],
      totalOutstanding: 600,
      totalSuppliers: 3,
      overdueSuppliers: 1,
    };
    const page = paginatePayablesSummary(result, { page: 2, limit: 2 });
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].supplier.name, 'Gamma');
    assert.equal(page.page, 2);
    assert.equal(page.total, 3);
    assert.equal(page.totalPages, 2);
    assert.equal(page.totalOutstanding, 600);
    assert.equal(page.totalSuppliers, 3);
    assert.equal(page.overdueSuppliers, 1);
    assert.equal(page.totals.current, 600);
    assert.equal(page.totals.currentCount, 3);
  });

  test('search narrows items and totals but not headline numbers', () => {
    const result = {
      items: [mk(1, 'Alpha Fuel', 300), mk(2, 'Beta Logistics', 200)],
      totalOutstanding: 500,
      totalSuppliers: 2,
      overdueSuppliers: 0,
    };
    const page = paginatePayablesSummary(result, { search: 'alpha' });
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].supplier.name, 'Alpha Fuel');
    assert.equal(page.totalOutstanding, 500); // full-set, unaffected by search
    assert.equal(page.totals.current, 300); // search-scoped
  });
});
