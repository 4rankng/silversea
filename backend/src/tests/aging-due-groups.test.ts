// Card 369 (REQ-5.10-01) "Tổng quát về tiền" — backend slice.
//
// Covers: dueGroups identity (inTerm + overdue ≈ totalOutstanding), presence-based
// counts (a row with both portions counts in BOTH groups), the 'overdue' bucket
// filter selecting exactly rows with any overdue portion, the four pre-existing
// buckets keeping their exact selection, and the /reports/payables-summary
// `bucket` param preserving full-set headline + due-group cards while items and
// totals scope down. DB fixtures follow customer-receivable-as-of.test.ts
// (committed rows + explicit cleanup); the HTTP harness follows ad-hoc-orders.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { inArray } from 'drizzle-orm';
import { TxnType, type PayableSummary } from '@tingting/shared';

import { client, db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import { invalidateReportCaches } from '../lib/report-cache';
import { globalErrorHandler } from '../middleware/errorHandler';
import paymentRoutes from '../routes/financial/payments.routes';
import {
  computeDueGroups,
  filterAgingByBucket,
  getCustomerAgingList,
  getPayablesSummary,
  getReceivablesSummary,
  paginatePayablesSummary,
  summarizePayablesTotals,
  type DueGroups,
  type PayablesListTotals,
} from '../services/aging.service';

// ─── Pure aggregation/filter semantics (no fixtures) ─────────────────────────

function agingRow(totalOutstanding: number, aging: { current: number; d30: number; d60: number; over90: number }) {
  return { totalOutstanding, aging };
}

function assertAmountClose(actual: number, expected: number, message: string) {
  assert.ok(Math.abs(actual - expected) <= 0.01, `${message} (actual ${actual}, expected ${expected})`);
}

describe('computeDueGroups — due-group cards', () => {
  test('presence-based counts: a row with in-term AND overdue portions counts in BOTH groups', () => {
    const groups = computeDueGroups([
      agingRow(300.75, { current: 100.5, d30: 0, d60: 0, over90: 200.25 }),
      agingRow(100, { current: 100, d30: 0, d60: 0, over90: 0 }),
      agingRow(150, { current: 0, d30: 150, d60: 0, over90: 0 }),
    ]);
    assert.deepEqual(groups, {
      inTerm: { amount: 200.5, count: 2 },
      overdue: { amount: 350.25, count: 2 },
    });
  });

  test('inTerm.amount + overdue.amount ≈ totalOutstanding within 0.02', () => {
    const rows = [
      agingRow(300.75, { current: 100.5, d30: 0, d60: 0, over90: 200.25 }),
      agingRow(50.5, { current: 0, d30: 50.5, d60: 0, over90: 0 }),
      agingRow(75.25, { current: 75.25, d30: 0, d60: 0, over90: 0 }),
    ];
    const groups = computeDueGroups(rows);
    const totalOutstanding = rows.reduce((sum, row) => sum + row.totalOutstanding, 0);
    assert.ok(Math.abs(groups.inTerm.amount + groups.overdue.amount - totalOutstanding) <= 0.02);
    assert.deepEqual(groups, {
      inTerm: { amount: 175.75, count: 2 },
      overdue: { amount: 250.75, count: 2 },
    });
  });

  test('amounts pass through round2dp', () => {
    // Single-row sums keep the rounding boundary exactly representable.
    const groups = computeDueGroups([agingRow(12.56, { current: 10.005, d30: 0, d60: 2.555, over90: 0 })]);
    assert.equal(groups.inTerm.amount, 10.01);
    assert.equal(groups.overdue.amount, 2.56);
    assert.ok(Math.abs(groups.inTerm.amount + groups.overdue.amount - 12.56) <= 0.02);
  });

  test('counts are presence-based: zero portions and zero-outstanding rows do not count', () => {
    // The zero-outstanding row can never enter a summary row set (rows carry
    // totalOutstanding > 0); its portions still sum, but it matches neither
    // drill-down predicate — keeping card counts == drill-down list lengths.
    const groups = computeDueGroups([
      agingRow(0, { current: 5, d30: 4, d60: 0, over90: 0 }),
      agingRow(6, { current: 0, d30: 0, d60: 0, over90: 6 }),
      agingRow(7, { current: 7, d30: 0, d60: 0, over90: 0 }),
    ]);
    assert.deepEqual(groups, {
      inTerm: { amount: 12, count: 1 },
      overdue: { amount: 10, count: 1 },
    });
  });
});

describe("filterAgingByBucket — 'overdue' pill", () => {
  const rows = [
    { name: 'r1', ...agingRow(100, { current: 100, d30: 0, d60: 0, over90: 0 }) },
    { name: 'r2', ...agingRow(150, { current: 0, d30: 150, d60: 0, over90: 0 }) },
    { name: 'r3', ...agingRow(160, { current: 0, d30: 0, d60: 160, over90: 0 }) },
    { name: 'r4', ...agingRow(170, { current: 0, d30: 0, d60: 0, over90: 170 }) },
    { name: 'r5', ...agingRow(180, { current: 10, d30: 0, d60: 0, over90: 170 }) },
    { name: 'r6', ...agingRow(0, { current: 0, d30: 9, d60: 0, over90: 0 }) },
    { name: 'r7', ...agingRow(400, { current: 100, d30: 100, d60: 100, over90: 100 }) },
  ];
  const names = (kept: typeof rows) => kept.map((row) => row.name);

  test("'overdue' selects exactly rows with any overdue portion and outstanding", () => {
    assert.deepEqual(names(filterAgingByBucket(rows, 'overdue')), ['r2', 'r3', 'r4', 'r5', 'r7']);
  });

  test("'all' is untouched and the four pre-existing buckets keep their exact selection", () => {
    assert.deepEqual(names(filterAgingByBucket(rows, 'all')), ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7']);
    for (const [bucket, expected] of [
      ['current', ['r1', 'r5', 'r7']],
      ['d30', ['r2', 'r7']],
      ['d60', ['r3', 'r7']],
      ['over90', ['r4', 'r5', 'r7']],
    ] as const) {
      assert.deepEqual(names(filterAgingByBucket(rows, bucket)), expected, `bucket ${bucket} changed`);
    }
  });
});

// ─── Route-level pagination semantics (no fixtures) ──────────────────────────

function payable(
  id: number,
  name: string,
  totalOutstanding: number,
  aging: { current: number; d30: number; d60: number; over90: number },
  kind: NonNullable<PayableSummary['kind']>,
): PayableSummary {
  return {
    supplier: {
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
    },
    totalOutstanding,
    aging,
    maxOverdueDays: 10,
    kind,
  };
}

describe('paginatePayablesSummary bucket scoping (GET /reports/payables-summary)', () => {
  const items = [
    payable(1, 'NCC Cả Hai', 3_000, { current: 1_000, d30: 0, d60: 0, over90: 2_000 }, 'vendor'),
    payable(2, 'NCC Trong Hạn', 500, { current: 500, d30: 0, d60: 0, over90: 0 }, 'vendor'),
    payable(3, 'NCC Quá Hạn', 700, { current: 0, d30: 700, d60: 0, over90: 0 }, 'carrier'),
  ];
  // Production shape: the route hands the envelope the FULL-set due groups while
  // narrowing items with filterAgingByBucket before search/pagination.
  const summary = {
    items,
    totalOutstanding: 4_200,
    totalSuppliers: 3,
    overdueSuppliers: 2,
    dueGroups: computeDueGroups(items),
  };

  test('bucket narrows items/totals while headline + dueGroups stay full-set', () => {
    const page = paginatePayablesSummary(
      { ...summary, items: filterAgingByBucket(summary.items, 'overdue') },
      { page: 1, limit: 10 },
    );
    assert.deepEqual(page.items.map((item) => item.supplier.name), ['NCC Cả Hai', 'NCC Quá Hạn']);
    assert.deepEqual(page.totals, summarizePayablesTotals(filterAgingByBucket(items, 'overdue')));
    assert.equal(page.total, 2);
    assert.equal(page.totalOutstanding, 4_200);
    assert.equal(page.totalSuppliers, 3);
    assert.equal(page.overdueSuppliers, 2);
    assert.deepEqual(page.dueGroups, computeDueGroups(items));
  });

  test('search narrows the bucketed set and totals follow (existing semantics)', () => {
    const page = paginatePayablesSummary(
      { ...summary, items: filterAgingByBucket(summary.items, 'overdue') },
      { search: 'cả hai', page: 1, limit: 10 },
    );
    assert.deepEqual(page.items.map((item) => item.supplier.name), ['NCC Cả Hai']);
    assert.deepEqual(page.totals, {
      current: 1_000, currentCount: 1,
      d30: 0, d30Count: 0,
      d60: 0, d60Count: 0,
      over90: 2_000, over90Count: 1,
    });
    assert.equal(page.totalOutstanding, 4_200);
  });
});

// ─── DB-backed payload wiring ────────────────────────────────────────────────

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
// Same far-future as-of idiom as customer-receivable-as-of.test.ts: the cutoff
// resolves to 2042-01-01T17:00:00.000Z with the aging reference at its 16:59:59.999Z.
const AS_OF = '2042-01-01';
const REF = Date.UTC(2042, 0, 1, 16, 59, 59, 999);
const daysBefore = (days: number) => new Date(REF - days * 86_400_000);
// Contractual due dates (card 061026221213): the bands are days past due, so
// the fixture stamps due dates to express in-term vs overdue, never age.
const dueAfter = (days: number) => new Date(REF + days * 86_400_000).toISOString().slice(0, 10);
const dueBefore = (days: number) => new Date(REF - days * 86_400_000).toISOString().slice(0, 10);

let server: http.Server;
let baseUrl: string;
const customerIds: number[] = [];
const supplierIds: number[] = [];
const ledgerIds: number[] = [];
const fixtureVendorIds = new Set<number>();

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', paymentRoutes);
  app.use(globalErrorHandler);
  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });

  // Receivables fixture: customer A carries BOTH an in-term (due +7d) and a
  // deeply overdue (103d past due → over90) portion; customer B is overdue-only
  // (20d past due → d30).
  const [customerA] = await db.insert(s.customers).values({ name: `Tổng quát both ${suffix}` }).returning();
  const [customerB] = await db.insert(s.customers).values({ name: `Tổng quát overdue ${suffix}` }).returning();
  customerIds.push(customerA.id, customerB.id);

  // Payables fixture (vendors): P1 both portions, P2 in-term only, P3 overdue
  // only. Vendor ledger credits invert into payable invoices (invertSigns).
  const [supplierP1] = await db.insert(s.suppliers).values({ name: `NCC both ${suffix}` }).returning();
  const [supplierP2] = await db.insert(s.suppliers).values({ name: `NCC intrm ${suffix}` }).returning();
  const [supplierP3] = await db.insert(s.suppliers).values({ name: `NCC over ${suffix}` }).returning();
  supplierIds.push(supplierP1.id, supplierP2.id, supplierP3.id);
  fixtureVendorIds.add(supplierP1.id).add(supplierP2.id).add(supplierP3.id);

  const rows = await db.insert(s.ledger).values([
    {
      entityType: 'CUSTOMER', entityId: customerA.id, txnType: TxnType.TRIP_REVENUE, txnId: 9_500_001,
      debit: '1000', credit: '0', balance: '1000', timestamp: daysBefore(12), originalDueDate: dueAfter(7),
    },
    {
      entityType: 'CUSTOMER', entityId: customerA.id, txnType: TxnType.TRIP_REVENUE, txnId: 9_500_002,
      debit: '2000', credit: '0', balance: '2000', timestamp: daysBefore(103), originalDueDate: dueBefore(103),
    },
    {
      entityType: 'CUSTOMER', entityId: customerB.id, txnType: TxnType.TRIP_REVENUE, txnId: 9_500_003,
      debit: '3000', credit: '0', balance: '3000', timestamp: daysBefore(47), originalDueDate: dueBefore(20),
    },
    {
      entityType: 'VENDOR', entityId: supplierP1.id, txnType: TxnType.VENDOR_EXPENSE, txnId: 9_500_004,
      debit: '0', credit: '10000', balance: '-10000', timestamp: daysBefore(12), originalDueDate: dueAfter(7),
    },
    {
      entityType: 'VENDOR', entityId: supplierP1.id, txnType: TxnType.VENDOR_EXPENSE, txnId: 9_500_005,
      debit: '0', credit: '20000', balance: '-20000', timestamp: daysBefore(103), originalDueDate: dueBefore(103),
    },
    {
      entityType: 'VENDOR', entityId: supplierP2.id, txnType: TxnType.VENDOR_EXPENSE, txnId: 9_500_006,
      debit: '0', credit: '5000', balance: '-5000', timestamp: daysBefore(12), originalDueDate: dueAfter(7),
    },
    {
      entityType: 'VENDOR', entityId: supplierP3.id, txnType: TxnType.VENDOR_EXPENSE, txnId: 9_500_007,
      debit: '0', credit: '7000', balance: '-7000', timestamp: daysBefore(47), originalDueDate: dueBefore(20),
    },
  ]).returning({ id: s.ledger.id });
  ledgerIds.push(...rows.map((row) => row.id));

  // Bust any stale entity-results cache so getPayablesSummary sees the fixture.
  await invalidateReportCaches();
});

after(async () => {
  try {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  } finally {
    try {
      if (ledgerIds.length) await db.delete(s.ledger).where(inArray(s.ledger.id, ledgerIds));
      if (supplierIds.length) await db.delete(s.suppliers).where(inArray(s.suppliers.id, supplierIds));
      if (customerIds.length) await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
    } finally {
      // Never leave fixture rows inside the 300s entity-results cache.
      try { await invalidateReportCaches(); } catch { /* non-critical */ }
      try { await disconnectRedis(); } catch { /* already-closed is fine */ }
      await client.end();
    }
  }
});

interface PayablesSummaryEnvelope {
  items: PayableSummary[];
  totalOutstanding: number;
  totalSuppliers: number;
  overdueSuppliers: number;
  dueGroups: DueGroups;
  totals: PayablesListTotals;
  total: number;
}

async function fetchPayables(query: string): Promise<PayablesSummaryEnvelope> {
  const response = await fetch(`${baseUrl}/api/reports/payables-summary${query}`);
  assert.equal(response.status, 200);
  return (await response.json()) as PayablesSummaryEnvelope;
}

describe('getReceivablesSummary dueGroups (snapshot rows)', () => {
  test('identity holds and counts match the /debt drill-down lists exactly', async () => {
    const [report, list] = await Promise.all([
      getReceivablesSummary({ asOfDate: AS_OF }),
      getCustomerAgingList({ asOfDate: AS_OF, page: 1, limit: 500 }),
    ]);
    const rows = list.customers;

    assert.ok(Math.abs((report.dueGroups.inTerm.amount + report.dueGroups.overdue.amount) - report.totalOutstanding) <= 0.02);

    const recomputed = computeDueGroups(rows);
    assert.deepEqual(
      { inTerm: report.dueGroups.inTerm.count, overdue: report.dueGroups.overdue.count },
      { inTerm: recomputed.inTerm.count, overdue: recomputed.overdue.count },
    );
    assertAmountClose(report.dueGroups.inTerm.amount, recomputed.inTerm.amount, 'in-term amount covers exactly the /debt rows');
    assertAmountClose(report.dueGroups.overdue.amount, recomputed.overdue.amount, 'overdue amount covers exactly the /debt rows');

    // Drill-down parity: clicking a card lands on a list of exactly that length.
    assert.equal(report.dueGroups.inTerm.count, filterAgingByBucket(rows, 'current').length);
    assert.equal(report.dueGroups.overdue.count, filterAgingByBucket(rows, 'overdue').length);
  });

  test('a customer with both in-term and overdue portions counts in BOTH groups', async () => {
    const [report, list] = await Promise.all([
      getReceivablesSummary({ asOfDate: AS_OF }),
      getCustomerAgingList({ asOfDate: AS_OF, page: 1, limit: 500 }),
    ]);
    const rows = list.customers;
    const fixtureIds = new Set(customerIds);
    const withoutFixtures = computeDueGroups(rows.filter((row) => !fixtureIds.has(row.customerId)));

    // Customer A contributes in-term 1 000 + overdue 2 000 and counts in both
    // groups (+1 inTerm); customer B contributes overdue 3 000 only (+1 more).
    assert.equal(report.dueGroups.inTerm.count, withoutFixtures.inTerm.count + 1);
    assert.equal(report.dueGroups.overdue.count, withoutFixtures.overdue.count + 2);
    assertAmountClose(report.dueGroups.inTerm.amount, withoutFixtures.inTerm.amount + 1_000, 'A only adds in-term');
    assertAmountClose(report.dueGroups.overdue.amount, withoutFixtures.overdue.amount + 5_000, 'A + B add overdue');

    const rowA = rows.find((row) => row.customerId === customerIds[0]);
    assert.ok(rowA);
    assert.equal(rowA.aging.current, 1_000);
    assert.equal(rowA.aging.over90, 2_000);
    const rowB = rows.find((row) => row.customerId === customerIds[1]);
    assert.ok(rowB);
    assert.deepEqual(rowB.aging, { current: 0, d30: 3_000, d60: 0, over90: 0 });
  });
});

describe('getPayablesSummary dueGroups (merged full item set)', () => {
  test('identity holds, counts match drill-down lists, and suppliers count in BOTH groups', async () => {
    const summary = await getPayablesSummary({ asOfDate: AS_OF });

    assert.ok(Math.abs((summary.dueGroups.inTerm.amount + summary.dueGroups.overdue.amount) - summary.totalOutstanding) <= 0.02);
    assert.equal(summary.dueGroups.inTerm.count, filterAgingByBucket(summary.items, 'current').length);
    assert.equal(summary.dueGroups.overdue.count, filterAgingByBucket(summary.items, 'overdue').length);

    const withoutFixtures = computeDueGroups(
      summary.items.filter((item) => !(item.kind === 'vendor' && fixtureVendorIds.has(item.supplier.id))),
    );
    // P1 (both) + P2 (in-term) add 15 000 in-term; P1 + P3 (d30) add 27 000 overdue.
    assert.equal(summary.dueGroups.inTerm.count, withoutFixtures.inTerm.count + 2);
    assert.equal(summary.dueGroups.overdue.count, withoutFixtures.overdue.count + 2);
    assertAmountClose(summary.dueGroups.inTerm.amount, withoutFixtures.inTerm.amount + 15_000, 'P1 + P2 add in-term');
    assertAmountClose(summary.dueGroups.overdue.amount, withoutFixtures.overdue.amount + 27_000, 'P1 + P3 add overdue');

    const itemP1 = summary.items.find((item) => item.kind === 'vendor' && item.supplier.id === supplierIds[0]);
    assert.ok(itemP1);
    assert.deepEqual(itemP1.aging, { current: 10_000, d30: 0, d60: 0, over90: 20_000 });
  });
});

describe('GET /reports/payables-summary?bucket= (route param)', () => {
  test('bucket preserves full-set headline + dueGroups while items/totals scope down', async () => {
    const [all, overdue, current] = await Promise.all([
      fetchPayables(`?asOfDate=${AS_OF}&limit=500`),
      fetchPayables(`?asOfDate=${AS_OF}&limit=500&bucket=overdue`),
      fetchPayables(`?asOfDate=${AS_OF}&limit=500&bucket=current`),
    ]);

    // Full-set invariants (KPI strip): headline numbers and due-group cards.
    for (const scoped of [overdue, current]) {
      assert.equal(scoped.totalOutstanding, all.totalOutstanding);
      assert.equal(scoped.totalSuppliers, all.totalSuppliers);
      assert.equal(scoped.overdueSuppliers, all.overdueSuppliers);
      assert.deepEqual(scoped.dueGroups, all.dueGroups);
    }

    const key = (item: PayableSummary) => `${item.kind}:${item.supplier.id}`;
    const overdueKeys = overdue.items.map(key);
    assert.deepEqual([...overdueKeys].sort(), all.items
      .filter((item) => item.aging.d30 > 0 || item.aging.d60 > 0 || item.aging.over90 > 0)
      .map(key).sort());
    assert.ok(overdue.items.every((item) => item.totalOutstanding > 0
      && (item.aging.d30 > 0 || item.aging.d60 > 0 || item.aging.over90 > 0)));
    assert.deepEqual(current.items.map(key).sort(), all.items
      .filter((item) => item.aging.current > 0)
      .map(key).sort());

    // Fixture rows land in the right pills: P1 (both) in both, P2 in-term, P3 overdue.
    assert.ok(overdueKeys.includes(`vendor:${supplierIds[0]}`) && overdueKeys.includes(`vendor:${supplierIds[2]}`));
    assert.ok(!overdueKeys.includes(`vendor:${supplierIds[1]}`));
    const currentKeys = current.items.map(key);
    assert.ok(currentKeys.includes(`vendor:${supplierIds[0]}`) && currentKeys.includes(`vendor:${supplierIds[1]}`));
    assert.ok(!currentKeys.includes(`vendor:${supplierIds[2]}`));

    // Totals scope to the filtered set exactly like the search-scoped totals.
    assert.deepEqual(overdue.totals, summarizePayablesTotals(all.items
      .filter((item) => item.aging.d30 > 0 || item.aging.d60 > 0 || item.aging.over90 > 0)));
    assert.deepEqual(current.totals, summarizePayablesTotals(all.items
      .filter((item) => item.aging.current > 0)));
    assert.equal(overdue.total, overdue.items.length);
    assert.equal(current.total, current.items.length);
  });
});
