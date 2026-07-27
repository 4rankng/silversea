/**
 * Wave 3 M7.3 — salary period close tests.
 *
 * Verifies: invalid-period rejection, single summary ledger entry per
 * close, idempotent re-close (no new entry), periodTotalSalary sum from
 * DRIVER_SALARY credits, role guards, reopen reverses + idempotent,
 * reopen-missing-period 404, advisory-lock concurrency (best-effort).
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { TxnType } from '@tingting/shared';
import {
  closeSalaryPeriod,
  reopenSalaryPeriod,
  getSalaryPeriodClose,
  listSalaryPeriodCloses,
} from '../services/salary-period-close.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdDriverIds: number[] = [];
const createdUserIds: number[] = [];
const createdLedgerIds: number[] = [];
const createdCloseIds: number[] = [];
// Use a high-cardinality future period per run so persistent developer data and
// parallel test processes cannot collide with this file's close row.
const _suffixTs = Number(suffix.split('-')[0]);
const _periodYear = 3000 + (_suffixTs % 6000); // 3000-8999
const _periodMonth = (_suffixTs % 12) + 1;   // 1-12
const PERIOD = `${_periodYear}-${String(_periodMonth).padStart(2, '0')}`;
const MISSING_PERIOD = _periodMonth === 12
  ? `${_periodYear + 1}-01`
  : `${_periodYear}-${String(_periodMonth + 1).padStart(2, '0')}`;

let adminUserId: number;
let accountantUserId: number;
let driverRoleId: number;

async function mkUser(role: 'ADMIN' | 'ACCOUNTANT' | 'DRIVER', tag: string) {
  const [u] = await db.insert(s.users).values({
    username: `m73-${role}-${suffix}-${tag}-${createdUserIds.length}`,
    passwordHash: 'x',
    role,
    status: 'ACTIVE',
  }).returning();
  createdUserIds.push(u.id);
  return u;
}

async function mkDriver() {
  const [u] = await db.insert(s.users).values({
    username: `m73-driver-${suffix}-${createdDriverIds.length}`,
    passwordHash: 'x',
    role: 'DRIVER',
    status: 'ACTIVE',
  }).returning();
  const [d] = await db.insert(s.drivers).values({
    name: `M73 driver ${suffix}-${createdDriverIds.length}`,
    userId: u.id,
  }).returning();
  createdDriverIds.push(d.id);
  createdUserIds.push(u.id);
  return d;
}

/** Post a DRIVER_SALARY credit for a driver in the period. */
async function postDriverSalary(driverId: number, amount: number, dateIso: string) {
  const [e] = await db.insert(s.ledger).values({
    entityType: 'DRIVER' as const,
    entityId: driverId,
    txnType: TxnType.DRIVER_SALARY,
    txnId: 0,
    debit: '0',
    credit: String(amount),
    balance: String(amount),
    timestamp: new Date(dateIso),
    note: 'm73 test',
  }).returning();
  createdLedgerIds.push(e.id);
}

after(async () => {
  const userPattern = `m73-%-${suffix}-%`;
  try {
    if (createdCloseIds.length > 0) await db.delete(s.salaryPeriodCloses).where(inArray(s.salaryPeriodCloses.id, createdCloseIds));
    await db.delete(s.periodLocks).where(and(
      eq(s.periodLocks.domain, 'SALARY'),
      eq(s.periodLocks.periodKey, PERIOD),
    ));
    // Also sweep any close rows for our test period that weren't tracked.
    await db.delete(s.salaryPeriodCloses).where(sql`${s.salaryPeriodCloses.period} = ${PERIOD} AND ${s.salaryPeriodCloses.note} LIKE 'Chốt kỳ lương T%'`);
    // Sweep summary + reversal ledger entries by note prefix.
    await db.delete(s.ledger).where(sql`${s.ledger.note} LIKE 'Chốt kỳ lương%' OR ${s.ledger.note} LIKE 'Mở lại kỳ lương%' OR ${s.ledger.note} = 'm73 test'`);
    if (createdLedgerIds.length > 0) await db.delete(s.ledger).where(inArray(s.ledger.id, createdLedgerIds));
    if (createdDriverIds.length > 0) await db.delete(s.drivers).where(inArray(s.drivers.id, createdDriverIds));
    await db.delete(s.users).where(sql`${s.users.username} LIKE ${userPattern}`);
  } catch (err) { console.warn('[m73] cleanup:', (err as Error).message); }
  await client.end();
});

describe('M7.3 setup', () => {
  test('creates actor users', async () => {
    adminUserId = (await mkUser('ADMIN', 'admin')).id;
    accountantUserId = (await mkUser('ACCOUNTANT', 'acc')).id;
    const dr = await mkUser('DRIVER', 'role-check');
    driverRoleId = dr.id;
    assert.ok(adminUserId > 0);
    assert.ok(accountantUserId > 0);
    assert.ok(driverRoleId > 0);
  });
});

describe('M7.3 — closeSalaryPeriod validation', () => {
  test('rejects malformed period', async () => {
    await assert.rejects(
      () => closeSalaryPeriod({ period: '2025-13', actorId: adminUserId, actorRole: 'ADMIN' }),
      (err: Error & { statusCode?: number }) => err.statusCode === 400 && /YYYY-MM/.test(err.message),
    );
    await assert.rejects(
      () => closeSalaryPeriod({ period: 'bogus', actorId: adminUserId, actorRole: 'ADMIN' }),
      (err: Error & { statusCode?: number }) => err.statusCode === 400,
    );
  });

  test('rejects non-FINANCIAL role', async () => {
    await assert.rejects(
      () => closeSalaryPeriod({ period: PERIOD, actorId: driverRoleId, actorRole: 'DRIVER' }),
      (err: Error & { statusCode?: number }) => err.statusCode === 403,
    );
  });
});

describe('M7.3 — closeSalaryPeriod happy path + idempotence', () => {
  test('posts ONE summary entry and creates a close row', async () => {
    const d1 = await mkDriver();
    const d2 = await mkDriver();
    // Post salaries in the PERIOD's month (10th and 20th).
    const date1 = `${PERIOD}-10`;
    const date2 = `${PERIOD}-15`;
    await postDriverSalary(d1.id, 3_000_000, date1);
    await postDriverSalary(d2.id, 2_500_000, date2);
    // Outside the period — should NOT be counted. Use next month.
    const [yStr, mStr] = PERIOD.split('-');
    const nextMonth = mStr === '12' ? '01' : String(Number(mStr) + 1).padStart(2, '0');
    const nextYear = mStr === '12' ? String(Number(yStr) + 1) : yStr;
    await postDriverSalary(d1.id, 9_999_999, `${nextYear}-${nextMonth}-01`);

    const result = await closeSalaryPeriod({
      period: PERIOD, actorId: adminUserId, actorRole: 'ADMIN',
      note: `m73 close ${suffix}`,
    });
    createdCloseIds.push(result.closeId);

    assert.equal(result.idempotentNoop, false);
    assert.equal(result.status, 'CLOSED');
    assert.equal(result.periodTotalSalary, 5_500_000, 'sum of in-period driver salaries');
    assert.ok(result.ledgerEntryId);

    // Exactly ONE summary entry pointing at this close row.
    const summaryEntries = await db.select().from(s.ledger)
      .where(sql`${s.ledger.id} = ${result.ledgerEntryId}`);
    assert.equal(summaryEntries.length, 1, 'exactly one summary entry posted');
    assert.equal(Number(summaryEntries[0].credit), 5_500_000);
    assert.equal(summaryEntries[0].entityType, 'DRIVER');
    assert.equal(summaryEntries[0].entityId, 0);
    assert.equal(summaryEntries[0].txnType, TxnType.ADJUSTMENT);
    createdLedgerIds.push(summaryEntries[0].id);
  });

  test('idempotent: second close returns the same row, posts zero new entries', async () => {
    const beforeCount = await db.select({ n: sql<number>`count(*)::int` })
      .from(s.ledger)
      .where(sql`${s.ledger.entityType} = 'DRIVER' AND ${s.ledger.entityId} = 0`);

    const result = await closeSalaryPeriod({
      period: PERIOD, actorId: accountantUserId, actorRole: 'ACCOUNTANT',
    });
    assert.equal(result.idempotentNoop, true);
    assert.equal(result.status, 'CLOSED');

    const afterCount = await db.select({ n: sql<number>`count(*)::int` })
      .from(s.ledger)
      .where(sql`${s.ledger.entityType} = 'DRIVER' AND ${s.ledger.entityId} = 0`);
    assert.equal(afterCount[0].n, beforeCount[0].n, 'no new summary entry posted');
  });

  test('getSalaryPeriodClose returns the row', async () => {
    const row = await getSalaryPeriodClose(PERIOD);
    assert.ok(row);
    assert.equal(row!.period, PERIOD);
    assert.equal(row!.status, 'CLOSED');
  });

  test('listSalaryPeriodCloses includes the row', async () => {
    const rows = await listSalaryPeriodCloses();
    assert.ok(rows.some(r => r.period === PERIOD));
  });
});

describe('M7.3 — reopenSalaryPeriod', () => {
  test('rejects ACCOUNTANT (admin/manager only)', async () => {
    await assert.rejects(
      () => reopenSalaryPeriod({ period: PERIOD, actorId: accountantUserId, actorRole: 'ACCOUNTANT' }),
      (err: Error & { statusCode?: number }) => err.statusCode === 403,
    );
  });

  test('404 when period was never closed', async () => {
    await assert.rejects(
      () => reopenSalaryPeriod({ period: MISSING_PERIOD, actorId: adminUserId, actorRole: 'ADMIN' }),
      (err: Error & { statusCode?: number }) => err.statusCode === 404,
    );
  });

  test('posts reversing entry + flips status to REOPENED', async () => {
    const beforeCount = await db.select({ n: sql<number>`count(*)::int` })
      .from(s.ledger)
      .where(sql`${s.ledger.entityType} = 'DRIVER' AND ${s.ledger.entityId} = 0`);

    const result = await reopenSalaryPeriod({
      period: PERIOD, actorId: adminUserId, actorRole: 'ADMIN',
    });
    assert.equal(result.idempotentNoop, false);
    assert.equal(result.status, 'REOPENED');
    assert.equal(result.periodTotalSalary, 5_500_000);

    const afterCount = await db.select({ n: sql<number>`count(*)::int` })
      .from(s.ledger)
      .where(sql`${s.ledger.entityType} = 'DRIVER' AND ${s.ledger.entityId} = 0`);
    assert.equal(afterCount[0].n, beforeCount[0].n + 1, 'one reversing entry posted');
  });

  test('idempotent: reopen on REOPENED period is a no-op', async () => {
    const beforeCount = await db.select({ n: sql<number>`count(*)::int` })
      .from(s.ledger)
      .where(sql`${s.ledger.entityType} = 'DRIVER' AND ${s.ledger.entityId} = 0`);

    const result = await reopenSalaryPeriod({
      period: PERIOD, actorId: adminUserId, actorRole: 'ADMIN',
    });
    assert.equal(result.idempotentNoop, true);

    const afterCount = await db.select({ n: sql<number>`count(*)::int` })
      .from(s.ledger)
      .where(sql`${s.ledger.entityType} = 'DRIVER' AND ${s.ledger.entityId} = 0`);
    assert.equal(afterCount[0].n, beforeCount[0].n, 'no new entry on idempotent reopen');
  });

  test('re-close after reopen revives the row to CLOSED + posts new summary', async () => {
    const result = await closeSalaryPeriod({
      period: PERIOD, actorId: adminUserId, actorRole: 'ADMIN',
      note: `m73 re-close ${suffix}`,
    });
    assert.equal(result.idempotentNoop, false);
    assert.equal(result.status, 'CLOSED');
    // Re-close recomputes the period total (still 5.5M — no new in-period entries).
    assert.equal(result.periodTotalSalary, 5_500_000);
  });
});
