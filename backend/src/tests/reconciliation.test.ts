/**
 * Wave 3 reconciliation tests — financial invariants across AR / AP / salary.
 *
 * Verifies three cross-cutting invariants:
 *   1. AR sum: Σ customer outstanding (per getCustomerArSummary) = Σ raw
 *      CUSTOMER-ledger balances (debit − credit).
 *   2. AP sum: Σ vendor payable (per getPayablesSummary) = Σ raw VENDOR-
 *      ledger balances (credit − debit).
 *   3. Salary close posts once: closing a period twice produces exactly
 *      ONE summary ledger entry (idempotence at the ledger level, not
 *      just at the service-return level).
 *
 * These are INVARIANT tests — they create controlled data, assert the
 * invariant, then clean up. They don't test edge cases (those live in
 * the per-feature test files); they verify the invariant holds across
 * the aggregation services and the raw ledger.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray, sql } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { TxnType } from '@tingting/shared';
import { getCustomerArSummary } from '../services/ar-status.service';
import { getPayablesSummary } from '../services/aging.service';
import { closeSalaryPeriod } from '../services/salary-period-close.service';
import { disconnectRedis, invalidateReportCaches } from '../lib/redis';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdCustomerIds: number[] = [];
const createdSupplierIds: number[] = [];
const createdLedgerIds: number[] = [];
const createdUserIds: number[] = [];
const createdDriverIds: number[] = [];
const createdCloseIds: number[] = [];

async function mkCustomer() {
  const [c] = await db.insert(s.customers).values({ name: `Recon cust ${suffix}-${createdCustomerIds.length}` }).returning();
  createdCustomerIds.push(c.id);
  return c;
}

async function mkSupplier() {
  const [sup] = await db.insert(s.suppliers).values({ name: `Recon sup ${suffix}-${createdSupplierIds.length}` }).returning();
  createdSupplierIds.push(sup.id);
  return sup;
}

async function mkAdmin() {
  const [u] = await db.insert(s.users).values({
    username: `recon-admin-${suffix}-${createdUserIds.length}`,
    passwordHash: 'x', role: 'ADMIN', status: 'ACTIVE',
  }).returning();
  createdUserIds.push(u.id);
  return u;
}

async function postLedger(opts: {
  entityType: 'CUSTOMER' | 'VENDOR' | 'DRIVER';
  entityId: number;
  txnType: TxnType;
  debit?: number;
  credit?: number;
}) {
  const debit = opts.debit ?? 0;
  const credit = opts.credit ?? 0;
  // Sign convention per LedgerService.postEntry:
  //   CUSTOMER: balance = debit − credit
  //   VENDOR/DRIVER: balance = credit − debit
  const balance = opts.entityType === 'CUSTOMER' ? debit - credit : credit - debit;
  const [e] = await db.insert(s.ledger).values({
    entityType: opts.entityType,
    entityId: opts.entityId,
    txnType: opts.txnType,
    txnId: 0,
    debit: String(debit),
    credit: String(credit),
    balance: String(balance),
    note: `recon test ${suffix}`,
  }).returning();
  createdLedgerIds.push(e.id);
  return e;
}

/** Raw sum of CUSTOMER-ledger balances for a set of customer IDs. */
async function rawCustomerBalances(customerIds: number[]): Promise<Map<number, number>> {
  const rows = await db.select({
    entityId: s.ledger.entityId,
    balance: sql<string>`coalesce(sum(case when ${s.ledger.txnType} IN ('TRIP_REVENUE','PAYMENT_RECEIVED','ADJUSTMENT','UNLOCK_REVERSAL','SERVICE_FEE','MANAGEMENT_FEE','PENALTY') then case when ${s.ledger.txnType} IN ('TRIP_REVENUE','SERVICE_FEE','MANAGEMENT_FEE','PENALTY','ADJUSTMENT') then ${s.ledger.debit} else -${s.ledger.credit} end else 0 end), 0)`,
  })
    .from(s.ledger)
    .where(sql`${s.ledger.entityType} = 'CUSTOMER' AND ${s.ledger.entityId} = ANY(ARRAY[${sql.join(customerIds.map(id => sql`${id}`), sql`, `)}]::int[])`)
    .groupBy(s.ledger.entityId);
  return new Map(rows.map(r => [Number(r.entityId), Number(r.balance)]));
}

/** Raw sum of VENDOR-ledger balances for a set of supplier IDs.
 *  VENDOR convention: credit = payable (positive). */
async function rawVendorBalances(supplierIds: number[]): Promise<Map<number, number>> {
  const rows = await db.select({
    entityId: s.ledger.entityId,
    balance: sql<string>`coalesce(sum(${s.ledger.credit} - ${s.ledger.debit}), 0)`,
  })
    .from(s.ledger)
    .where(sql`${s.ledger.entityType} = 'VENDOR' AND ${s.ledger.entityId} = ANY(ARRAY[${sql.join(supplierIds.map(id => sql`${id}`), sql`, `)}]::int[])`)
    .groupBy(s.ledger.entityId);
  return new Map(rows.map(r => [Number(r.entityId), Number(r.balance)]));
}

after(async () => {
  const custPattern = `Recon cust ${suffix}%`;
  const supPattern = `Recon sup ${suffix}%`;
  const userPattern = `recon-%-${suffix}-%`;
  try {
    // Sweep close rows for our test period.
    await db.delete(s.salaryPeriodCloses).where(sql`${s.salaryPeriodCloses.note} LIKE '%recon%'`);
    if (createdCloseIds.length > 0) await db.delete(s.salaryPeriodCloses).where(inArray(s.salaryPeriodCloses.id, createdCloseIds));
    // Sweep ALL recon-test ledger rows by note.
    await db.delete(s.ledger).where(sql`${s.ledger.note} LIKE ${'recon test ' + suffix + '%'} OR ${s.ledger.note} LIKE ${'Chốt kỳ lương%recon%'}`);
    if (createdLedgerIds.length > 0) await db.delete(s.ledger).where(inArray(s.ledger.id, createdLedgerIds));
    if (createdDriverIds.length > 0) await db.delete(s.drivers).where(inArray(s.drivers.id, createdDriverIds));
    await db.delete(s.customers).where(sql`${s.customers.name} LIKE ${custPattern}`);
    await db.delete(s.suppliers).where(sql`${s.suppliers.name} LIKE ${supPattern}`);
    await db.delete(s.users).where(sql`${s.users.username} LIKE ${userPattern}`);
  } catch (err) { console.warn('[recon] cleanup:', (err as Error).message); }
  // Tear down every long-lived handle the test opened so the Node test
  // process can exit cleanly under `tsx --test`. Mirrors the pattern in
  // chiho-reconciliation.test.ts:
  //   - invalidateReportCaches(): clear the Redis cache layer so a later
  //     suite does not see our recon rows via a stale 300s-TTL entry.
  //   - disconnectRedis(): the ioredis client keeps a socket open and would
  //     otherwise hang the runner between files. Without this call the
  //     process never exits even after client.end() drains the DB pool.
  //   - client.end({ timeout: 1 }): drain the postgres pool.
  try { await invalidateReportCaches(); } catch { /* non-critical */ }
  try { await disconnectRedis(); } catch { /* already-closed is fine */ }
  try { await client.end({ timeout: 1 }); } catch { /* ignore */ }
});

// ─── Invariant 1: AR sum = ledger sum ────────────────────────────────────────

describe('Reconciliation — AR sum = ledger sum', () => {
  test('getCustomerArSummary outstanding matches raw CUSTOMER-ledger balance', async () => {
    const c = await mkCustomer();
    // Post: 5M revenue + 2M payment → outstanding = 3M.
    await postLedger({ entityType: 'CUSTOMER', entityId: c.id, txnType: TxnType.TRIP_REVENUE, debit: 5_000_000 });
    await postLedger({ entityType: 'CUSTOMER', entityId: c.id, txnType: TxnType.PAYMENT_RECEIVED, credit: 2_000_000 });

    const summary = await getCustomerArSummary(c.id);
    assert.equal(summary.outstanding, 3_000_000);

    const rawMap = await rawCustomerBalances([c.id]);
    const rawBalance = rawMap.get(c.id) ?? 0;
    assert.equal(rawBalance, 3_000_000, 'raw ledger balance matches AR summary');
    assert.equal(summary.outstanding, rawBalance, 'AR service = raw ledger');
  });

  test('multiple customers: Σ outstanding = Σ raw balances', async () => {
    const c1 = await mkCustomer();
    const c2 = await mkCustomer();
    const c3 = await mkCustomer();
    await postLedger({ entityType: 'CUSTOMER', entityId: c1.id, txnType: TxnType.TRIP_REVENUE, debit: 1_000_000 });
    await postLedger({ entityType: 'CUSTOMER', entityId: c2.id, txnType: TxnType.TRIP_REVENUE, debit: 2_000_000 });
    await postLedger({ entityType: 'CUSTOMER', entityId: c2.id, txnType: TxnType.PAYMENT_RECEIVED, credit: 500_000 });
    await postLedger({ entityType: 'CUSTOMER', entityId: c3.id, txnType: TxnType.TRIP_REVENUE, debit: 3_000_000 });

    const [s1, s2, s3] = await Promise.all([
      getCustomerArSummary(c1.id),
      getCustomerArSummary(c2.id),
      getCustomerArSummary(c3.id),
    ]);
    const serviceSum = s1.outstanding + s2.outstanding + s3.outstanding;

    const rawMap = await rawCustomerBalances([c1.id, c2.id, c3.id]);
    const rawSum = (rawMap.get(c1.id) ?? 0) + (rawMap.get(c2.id) ?? 0) + (rawMap.get(c3.id) ?? 0);

    assert.equal(serviceSum, rawSum, 'Σ AR service outstanding = Σ raw ledger balances');
  });
});

// ─── Invariant 2: AP sum = ledger sum ────────────────────────────────────────

describe('Reconciliation — AP sum = ledger sum', () => {
  test('getPayablesSummary total matches raw VENDOR-ledger sum', async () => {
    const sup = await mkSupplier();
    // VENDOR: credit increases payable.
    await postLedger({ entityType: 'VENDOR', entityId: sup.id, txnType: TxnType.VENDOR_EXPENSE, credit: 4_000_000 });
    await postLedger({ entityType: 'VENDOR', entityId: sup.id, txnType: TxnType.VENDOR_PAYMENT, debit: 1_500_000 });

    const rawMap = await rawVendorBalances([sup.id]);
    const rawPayable = rawMap.get(sup.id) ?? 0;
    assert.equal(rawPayable, 2_500_000, 'raw VENDOR balance = 4M payable − 1.5M paid');

    // Invalidate the report cache so getPayablesSummary() recomputes from the
    // ledger rows we just posted. Without this, a stale 300s-TTL cache entry
    // (populated by an earlier test or seed) hides the new supplier and the
    // invariant assertion fails for a reason unrelated to the math.
    await invalidateReportCaches();

    // getPayablesSummary aggregates across ALL vendors — verify our supplier
    // appears with the expected outstanding.
    const summary = await getPayablesSummary();
    const item = summary.items.find(i => i.supplier.id === sup.id);
    assert.ok(item, 'supplier appears in payables summary');
    // getPayablesSummary uses FIFO aging which may differ slightly from the
    // raw balance when there are timing differences, but for a simple
    // expense + payment pair the outstanding should match exactly.
    assert.equal(item!.totalOutstanding, rawPayable, 'payables summary outstanding = raw VENDOR balance');
  });
});

// ─── Invariant 3: salary close posts once ────────────────────────────────────

describe('Reconciliation — salary close posts once', () => {
  test('closing a period twice produces exactly ONE summary ledger entry', async () => {
    const admin = await mkAdmin();
    // Post one DRIVER_SALARY credit in a unique period.
    const [u] = await db.insert(s.users).values({
      username: `recon-driver-${suffix}-${createdUserIds.length}`,
      passwordHash: 'x', role: 'DRIVER', status: 'ACTIVE',
    }).returning();
    createdUserIds.push(u.id);
    const [d] = await db.insert(s.drivers).values({ name: `Recon driver ${suffix}`, userId: u.id }).returning();
    createdDriverIds.push(d.id);

    // Use a unique period derived from suffix so we don't collide with other tests.
    const ts = parseInt(suffix.split('-')[0].slice(-6), 10);
    const period = `${2020 + (ts % 5)}-${String((ts % 12) + 1).padStart(2, '0')}`;
    const [yStr, mStr] = period.split('-');
    const salaryDate = `${period}-15`;
    await postLedger({ entityType: 'DRIVER', entityId: d.id, txnType: TxnType.DRIVER_SALARY, credit: 2_000_000 });

    // Override the timestamp to fall in the period.
    await db.update(s.ledger).set({ timestamp: new Date(salaryDate) })
      .where(inArray(s.ledger.id, createdLedgerIds.slice(-1)));

    // Close once.
    const r1 = await closeSalaryPeriod({ period, actorId: admin.id, actorRole: 'ADMIN', note: `recon close ${suffix}` });
    createdCloseIds.push(r1.closeId);
    assert.equal(r1.idempotentNoop, false);

    // Count summary entries BEFORE second close.
    const beforeRows = await db.select({ n: sql<number>`count(*)::int` })
      .from(s.ledger)
      .where(sql`${s.ledger.entityType} = 'DRIVER' AND ${s.ledger.entityId} = 0 AND ${s.ledger.note} LIKE ${'%' + suffix + '%'}`);

    // Close again — should be idempotent.
    const r2 = await closeSalaryPeriod({ period, actorId: admin.id, actorRole: 'ADMIN', note: `recon close ${suffix}` });
    assert.equal(r2.idempotentNoop, true);
    assert.equal(r2.closeId, r1.closeId);

    // Count summary entries AFTER second close — must be the same.
    const afterRows = await db.select({ n: sql<number>`count(*)::int` })
      .from(s.ledger)
      .where(sql`${s.ledger.entityType} = 'DRIVER' AND ${s.ledger.entityId} = 0 AND ${s.ledger.note} LIKE ${'%' + suffix + '%'}`);

    assert.equal(afterRows[0].n, beforeRows[0].n, 'second close posted zero new summary entries');
    assert.equal(beforeRows[0].n, 1, 'exactly ONE summary entry from the first close');

    void yStr; void mStr; // silence unused
  });
});
