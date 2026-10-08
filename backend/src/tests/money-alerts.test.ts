/**
 * Card 370 (REQ-5.10-02) — GET /api/accounting/money-alerts service suite.
 *
 * Pins the contract's named trap (fundNegative = tm < 0 && company < 0 in all
 * four sign directions), the disjoint 4-group due-debt classification at every
 * boundary, the unrefunded-deposit parity with listDepositTrackers, the
 * overdueDebt parity with getReceivablesSummary's dueGroups.overdue, and the
 * reserve formula reserve = tm + company − payablesDue5d.
 *
 * AS_OF is far-future so the narrow due windows ([asOf, asOf+5] and the
 * overdue buckets) can only contain this fixture's rows; the wide
 * overdue30plus bucket and the global deposit/fund totals are asserted as
 * baseline deltas or cross-endpoint parities, so pre-existing DB rows cannot
 * flip an expectation.
 *
 * Run: TZ=UTC npx tsx --test --test-concurrency=1 src/tests/money-alerts.test.ts
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { and, eq, inArray } from 'drizzle-orm';
import { Role, TxnType, round2dp } from '@tingting/shared';

import { client, db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import { getReceivablesSummary } from '../services/aging.service';
import { listDepositTrackers } from '../services/deposit-refund-tracker.service';
import {
  getMoneyAlertsSummary,
  type MoneyAlertsDueGroupKey,
} from '../services/money-alerts.service';
import { getTreasuryPositions } from '../services/treasury.service';

const AS_OF = '2099-03-10';

/** ISO date `offsetDays` from AS_OF (positive = future). */
function dueIn(offsetDays: number): string {
  const base = Date.UTC(2099, 2, 10);
  return new Date(base + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const cleanup: Array<() => Promise<void>> = [];
const track = (fn: () => Promise<void>) => cleanup.unshift(fn);

let userId = 0;
let tmAccountId = 0;
let companyAccountId = 0;
let supplierId = 0;
const customerIds: Record<'c1' | 'c2' | 'c3', number> = { c1: 0, c2: 0, c3: 0 };
const ledgerIds: number[] = [];

before(async () => {
  const [user] = await db.insert(s.users).values({
    username: `card370-${suffix}-acct`,
    passwordHash: 'x',
    role: 'ACCOUNTANT',
  }).returning({ id: s.users.id });
  userId = user.id;
  track(async () => { await db.delete(s.users).where(eq(s.users.id, userId)); });

  const [tmAccount] = await db.insert(s.treasuryAccounts).values({
    code: `CARD370-${suffix}-TM`,
    name: `card370 TM ${suffix}`,
    type: 'CASH',
    fundCode: 'TM',
    status: 'ACTIVE',
    openingBalance: '0',
    createdBy: userId,
    updatedBy: userId,
  }).returning({ id: s.treasuryAccounts.id });
  tmAccountId = tmAccount.id;
  const [companyAccount] = await db.insert(s.treasuryAccounts).values({
    code: `CARD370-${suffix}-COMPANY`,
    name: `card370 COMPANY ${suffix}`,
    type: 'BANK',
    fundCode: 'COMPANY',
    status: 'ACTIVE',
    openingBalance: '0',
    createdBy: userId,
    updatedBy: userId,
  }).returning({ id: s.treasuryAccounts.id });
  companyAccountId = companyAccount.id;
  track(async () => {
    await db.delete(s.treasuryAccounts).where(inArray(s.treasuryAccounts.id, [tmAccountId, companyAccountId]));
  });

  const customers = await db.insert(s.customers).values([
    { name: `card370 c1 ${suffix}` },
    { name: `card370 c2 ${suffix}` },
    { name: `card370 c3 ${suffix}` },
  ]).returning({ id: s.customers.id });
  customerIds.c1 = customers[0].id;
  customerIds.c2 = customers[1].id;
  customerIds.c3 = customers[2].id;
  track(async () => {
    await db.delete(s.customers).where(inArray(s.customers.id, Object.values(customerIds)));
  });

  const [supplier] = await db.insert(s.suppliers).values({
    name: `card370 ncc ${suffix}`,
  }).returning({ id: s.suppliers.id });
  supplierId = supplier.id;
  track(async () => { await db.delete(s.suppliers).where(eq(s.suppliers.id, supplierId)); });

  const trackers = await db.insert(s.depositRefundTrackers).values([
    {
      billNumber: `CARD370-${suffix}-A`, customerName: `KH ${suffix}`, carrierName: `VC ${suffix}`,
      depositAmount: '1000000', status: 'CHUA_HOAN_CUOC',
    },
    {
      billNumber: `CARD370-${suffix}-B`, customerName: `KH ${suffix}`, carrierName: `VC ${suffix}`,
      depositAmount: '2500000', status: 'CHUA_HOAN_CUOC',
    },
    {
      billNumber: `CARD370-${suffix}-C`, customerName: `KH ${suffix}`, carrierName: `VC ${suffix}`,
      depositAmount: '9000000', status: 'DA_HOAN_CUOC',
    },
  ]).returning({ id: s.depositRefundTrackers.id });
  track(async () => {
    await db.delete(s.depositRefundTrackers).where(inArray(s.depositRefundTrackers.id, trackers.map((row) => row.id)));
  });

  track(async () => {
    if (ledgerIds.length) await db.delete(s.ledger).where(inArray(s.ledger.id, ledgerIds));
  });
});

after(async () => {
  try {
    for (const fn of cleanup) await fn();
  } finally {
    await client.end();
    await disconnectRedis();
  }
});

/**
 * Force the WHOLE TM / COMPANY fund totals to the exact wanted values: the
 * fixture accounts absorb (wanted − everyone else) so the assertion is exact
 * whatever else lives in the shared DB. Balance math delegated to
 * getTreasuryPositions — no parallel formula in the test either.
 */
async function setFundTotals(tmTotal: number, companyTotal: number) {
  const accounts = await db.select({ id: s.treasuryAccounts.id, fundCode: s.treasuryAccounts.fundCode })
    .from(s.treasuryAccounts)
    .where(and(
      eq(s.treasuryAccounts.status, 'ACTIVE'),
      inArray(s.treasuryAccounts.fundCode, ['TM', 'COMPANY']),
    ));
  const others = accounts.filter((account) => account.id !== tmAccountId && account.id !== companyAccountId);
  const positions = await getTreasuryPositions(others.map((account) => account.id));
  const othersTotal = { TM: 0, COMPANY: 0 };
  for (const position of positions) {
    if (position.fundCode === 'TM') othersTotal.TM += position.bookBalance;
    else if (position.fundCode === 'COMPANY') othersTotal.COMPANY += position.bookBalance;
  }
  await db.update(s.treasuryAccounts)
    .set({ openingBalance: String(tmTotal - othersTotal.TM) })
    .where(eq(s.treasuryAccounts.id, tmAccountId));
  await db.update(s.treasuryAccounts)
    .set({ openingBalance: String(companyTotal - othersTotal.COMPANY) })
    .where(eq(s.treasuryAccounts.id, companyAccountId));
}

async function insertReceivableRows(rows: Array<{
  customerKey: 'c1' | 'c2' | 'c3';
  txnId: number;
  amount: number;
  due: string | null;
  txnType?: TxnType;
  credit?: number;
}>) {
  const inserted = await db.insert(s.ledger).values(rows.map((row) => ({
    entityType: 'CUSTOMER',
    entityId: customerIds[row.customerKey],
    txnType: row.txnType ?? TxnType.TRIP_REVENUE,
    txnId: row.txnId,
    debit: String(row.credit ? 0 : row.amount),
    credit: String(row.credit ?? 0),
    balance: '0',
    // 2099-01-01: inside the AS_OF cutoff; the null-due fixture relies on
    // this issue date landing 68 days back → overdue30plus.
    timestamp: new Date('2099-01-01T00:00:00.000Z'),
    originalDueDate: row.due,
    processingDueDate: null,
  }))).returning({ id: s.ledger.id });
  ledgerIds.push(...inserted.map((row) => row.id));
}

describe('getMoneyAlertsSummary (card 370)', () => {
  test('fundNegative is tm < 0 AND company < 0 — all four sign directions', async () => {
    // The spec's named trap: one negative fund is NOT 'Quỹ âm'. Table-driven,
    // both directions asserted per row, zero pinned as not-negative.
    const cases: Array<{ name: string; tm: number; company: number; expected: boolean }> = [
      { name: 'both positive', tm: 100, company: 200, expected: false },
      { name: 'tm negative only', tm: -100, company: 200, expected: false },
      { name: 'company negative only', tm: 100, company: -200, expected: false },
      { name: 'both negative', tm: -100, company: -200, expected: true },
      { name: 'zero is not negative', tm: 0, company: -200, expected: false },
    ];
    for (const c of cases) {
      await setFundTotals(c.tm, c.company);
      const summary = await getMoneyAlertsSummary({ asOfDate: AS_OF });
      assert.equal(summary.funds.tm, c.tm, `${c.name}: tm`);
      assert.equal(summary.funds.company, c.company, `${c.name}: company`);
      assert.equal(summary.fundNegative, c.expected, `${c.name}: fundNegative`);
    }
  });

  test('dueDebtGroups classify obligations disjointly at the boundaries', async () => {
    const baseline = await getMoneyAlertsSummary({ asOfDate: AS_OF });

    // One obligation per boundary point of the contract's windows.
    await insertReceivableRows([
      { customerKey: 'c1', txnId: 9_300_001, amount: 1_111, due: dueIn(0) },    // due exactly asOf → dueSoon5d
      { customerKey: 'c1', txnId: 9_300_002, amount: 2_222, due: dueIn(5) },    // due asOf+5 → dueSoon5d
      { customerKey: 'c1', txnId: 9_300_003, amount: 4_444, due: dueIn(6) },    // future > 5d → excluded
      { customerKey: 'c2', txnId: 9_300_004, amount: 3_333, due: dueIn(-1) },   // 1 day overdue
      { customerKey: 'c3', txnId: 9_300_005, amount: 5_555, due: dueIn(-10) },  // 10 days overdue
      { customerKey: 'c1', txnId: 9_300_006, amount: 6_666, due: dueIn(-11) },  // 11 days overdue
      { customerKey: 'c1', txnId: 9_300_007, amount: 7_777, due: dueIn(-30) },  // 30 days overdue
      { customerKey: 'c1', txnId: 9_300_008, amount: 8_888, due: dueIn(-31) },  // 31 days overdue
      { customerKey: 'c1', txnId: 9_300_009, amount: 9_999, due: dueIn(-90) },  // 90 days overdue
      // No frozen due date → authority fallback (issue date 2099-01-01) lands
      // in overdue30plus: un-dated debt is never hidden.
      { customerKey: 'c3', txnId: 9_300_010, amount: 333, due: null },
    ]);
    // Fully-paid obligation at the due-today boundary: outstanding 0 must not
    // count in any group.
    await insertReceivableRows([
      { customerKey: 'c2', txnId: 9_300_011, amount: 10_000, due: dueIn(0) },
      { customerKey: 'c2', txnId: 9_300_011, amount: 10_000, due: dueIn(0), txnType: TxnType.PAYMENT_RECEIVED, credit: 10_000 },
    ]);

    const after = await getMoneyAlertsSummary({ asOfDate: AS_OF });

    assert.deepEqual(after.dueDebtGroups.map((group) => group.key),
      ['dueSoon5d', 'overdue1to10', 'overdue11to30', 'overdue30plus']);
    assert.deepEqual(after.dueDebtGroups.map((group) => group.label),
      ['Sắp đến hạn (≤ 5 ngày)', 'Quá hạn 1–10 ngày', 'Quá hạn 30 ngày', 'Quá hạn 60 ngày']);

    const expected: Record<MoneyAlertsDueGroupKey, { amount: number; customers: number }> = {
      // c1 twice → distinct customers = 1.
      dueSoon5d: { amount: 1_111 + 2_222, customers: 1 },
      // c2 + c3 → distinct customers = 2.
      overdue1to10: { amount: 3_333 + 5_555, customers: 2 },
      // c1 twice → distinct customers = 1.
      overdue11to30: { amount: 6_666 + 7_777, customers: 1 },
      // 31d + 90d + the un-dated fallback obligation; c1 + c3.
      overdue30plus: { amount: 8_888 + 9_999 + 333, customers: 2 },
    };

    let amountDelta = 0;
    for (const group of after.dueDebtGroups) {
      const base = baseline.dueDebtGroups.find((g) => g.key === group.key) ?? { amount: 0, customers: 0 };
      const want = expected[group.key];
      assert.equal(group.amount, round2dp(base.amount + want.amount), `amount ${group.key}`);
      assert.equal(group.customers, base.customers + want.customers, `customers ${group.key}`);
      amountDelta += group.amount - base.amount;
    }
    // Disjoint + exclusion: exactly the classified obligations' money landed,
    // so the asOf+6 future row (4_444) and the paid row (10_000) appear in
    // NO group.
    assert.equal(amountDelta, round2dp(1_111 + 2_222 + 3_333 + 5_555 + 6_666 + 7_777 + 8_888 + 9_999 + 333));
  });

  test('unrefundedDeposits equals a direct CHUA_HOAN_CUOC count/sum', async () => {
    const summary = await getMoneyAlertsSummary({ asOfDate: AS_OF });

    const directRows = await db.select().from(s.depositRefundTrackers)
      .where(eq(s.depositRefundTrackers.status, 'CHUA_HOAN_CUOC'));
    assert.equal(summary.unrefundedDeposits.count, directRows.length);
    assert.equal(summary.unrefundedDeposits.amount,
      round2dp(directRows.reduce((sum, row) => sum + Number(row.depositAmount), 0)));

    // Parity with listDepositTrackers semantics (same rows, same sum).
    const listed = await listDepositTrackers({ userId: 0, role: Role.ACCOUNTANT }, { status: 'CHUA_HOAN_CUOC' });
    assert.equal(summary.unrefundedDeposits.count, listed.items.length);
    assert.equal(summary.unrefundedDeposits.amount,
      round2dp(listed.items.reduce((sum, row) => sum + Number(row.depositAmount), 0)));

    // The fixture's two CHUA lots (1_000_000 + 2_500_000) are counted; the
    // DA_HOAN_CUOC lot is not.
    assert.ok(summary.unrefundedDeposits.count >= 2);
    assert.ok(summary.unrefundedDeposits.amount >= 3_500_000);
  });

  test('overdueDebt equals getReceivablesSummary dueGroups.overdue on the same rows', async () => {
    const [report, summary] = await Promise.all([
      getReceivablesSummary({ asOfDate: AS_OF }),
      getMoneyAlertsSummary({ asOfDate: AS_OF }),
    ]);
    assert.deepEqual(summary.overdueDebt, {
      customers: report.dueGroups.overdue.count,
      amount: round2dp(report.dueGroups.overdue.amount),
    });
    // Non-vacuous: the fixture carries real overdue aging portions.
    assert.ok(summary.overdueDebt.amount > 0);
  });

  test('reserve = tm + company − payablesDue5d', async () => {
    await setFundTotals(50_000_000, 70_000_000);

    // Phase A — the [asOf, asOf+5] payable window holds nothing before the
    // fixture lands: reserve equals tm + company exactly.
    const preFixture = await getMoneyAlertsSummary({ asOfDate: AS_OF });
    assert.equal(preFixture.funds.reserve, 120_000_000);

    // Phase B — VENDOR payables for one supplier. FIFO (oldest-first) settlement:
    // the 9_000_000 payment eats P1 first, leaving 1_000_000 of it outstanding.
    const inserted = await db.insert(s.ledger).values([
      // P1: processingDueDate (in window) wins over its originalDueDate (out of
      // window) → in-window outstanding 1_000_000 after the payment.
      {
        entityType: 'VENDOR', entityId: supplierId, txnType: TxnType.FUEL_EXPENSE, txnId: 9_400_001,
        debit: '0', credit: '10000000', balance: '0',
        timestamp: new Date('2099-01-05T00:00:00.000Z'),
        originalDueDate: dueIn(6), processingDueDate: dueIn(3),
      },
      // P2: originalDueDate only, due exactly asOf+5 → in window, 4_000_000.
      {
        entityType: 'VENDOR', entityId: supplierId, txnType: TxnType.FUEL_EXPENSE, txnId: 9_400_002,
        debit: '0', credit: '4000000', balance: '0',
        timestamp: new Date('2099-01-06T00:00:00.000Z'),
        originalDueDate: dueIn(5), processingDueDate: null,
      },
      // P3: due asOf+6 → outside the window, never drained from the reserve.
      {
        entityType: 'VENDOR', entityId: supplierId, txnType: TxnType.VENDOR_EXPENSE, txnId: 9_400_003,
        debit: '0', credit: '7000000', balance: '0',
        timestamp: new Date('2099-01-07T00:00:00.000Z'),
        originalDueDate: null, processingDueDate: dueIn(6),
      },
      // P4: already overdue before asOf → outside [asOf, asOf+5].
      {
        entityType: 'VENDOR', entityId: supplierId, txnType: TxnType.VENDOR_EXPENSE, txnId: 9_400_004,
        debit: '0', credit: '2000000', balance: '0',
        timestamp: new Date('2099-01-08T00:00:00.000Z'),
        originalDueDate: null, processingDueDate: dueIn(-1),
      },
      // Payment settling the oldest obligation first.
      {
        entityType: 'VENDOR', entityId: supplierId, txnType: TxnType.VENDOR_PAYMENT, txnId: 9_400_005,
        debit: '9000000', credit: '0', balance: '0',
        timestamp: new Date('2099-01-09T00:00:00.000Z'),
        originalDueDate: null, processingDueDate: null,
      },
    ]).returning({ id: s.ledger.id });
    ledgerIds.push(...inserted.map((row) => row.id));

    const after = await getMoneyAlertsSummary({ asOfDate: AS_OF });
    // payablesDue5d = 1_000_000 (P1 remaining) + 4_000_000 (P2) = 5_000_000.
    assert.equal(after.funds.tm, 50_000_000);
    assert.equal(after.funds.company, 70_000_000);
    assert.equal(after.funds.reserve, round2dp(50_000_000 + 70_000_000 - 5_000_000));
  });
});
