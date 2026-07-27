import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { TxnType } from '@tingting/shared';
import { createPenalty, cancelPenalty } from '../services/financial.service';
import { LedgerService } from '../services/ledger.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdDriverIds: number[] = [];
const createdPenaltyIds: number[] = [];

async function mkDriver() {
  const [driver] = await db.insert(s.drivers).values({
    name: `Q23 driver ${suffix}-${createdDriverIds.length}`,
  }).returning();
  createdDriverIds.push(driver.id);
  return driver;
}

async function mkPenalty(driverId: number, amount = 450_000) {
  const penalty = await createPenalty({
    driverId,
    amount,
    date: '2026-07-27',
    customReason: `Q23 race ${suffix}`,
  });
  createdPenaltyIds.push(penalty.id);
  return penalty;
}

async function penaltyLedgerRows(penaltyId: number, driverId: number) {
  return db.select({
    id: s.ledger.id,
    txnType: s.ledger.txnType,
    debit: s.ledger.debit,
    credit: s.ledger.credit,
    note: s.ledger.note,
    balance: s.ledger.balance,
  }).from(s.ledger)
    .where(and(
      eq(s.ledger.entityType, 'DRIVER'),
      eq(s.ledger.entityId, driverId),
      eq(s.ledger.txnId, penaltyId),
    ))
    .orderBy(s.ledger.id);
}

after(async () => {
  try {
    if (createdDriverIds.length > 0 && createdPenaltyIds.length > 0) {
      await db.delete(s.ledger).where(and(
        eq(s.ledger.entityType, 'DRIVER'),
        inArray(s.ledger.entityId, createdDriverIds),
        inArray(s.ledger.txnId, createdPenaltyIds),
      ));
    }
    if (createdPenaltyIds.length > 0) {
      await db.delete(s.penalties).where(inArray(s.penalties.id, createdPenaltyIds));
    }
    if (createdDriverIds.length > 0) {
      await db.delete(s.drivers).where(inArray(s.drivers.id, createdDriverIds));
    }
  } catch (err) {
    console.warn('[q23-penalty-cancel] cleanup:', (err as Error).message);
  }
  await client.end();
});

describe('Q23 penalty cancel race', () => {
  test('second sequential cancel returns 409 and posts no extra reversal', async () => {
    const driver = await mkDriver();
    const penalty = await mkPenalty(driver.id);

    await cancelPenalty(penalty.id, `Q23 race ${suffix} sequential`);
    await assert.rejects(
      () => cancelPenalty(penalty.id, `Q23 race ${suffix} duplicate`),
      (err: Error & { statusCode?: number }) => err.statusCode === 409,
    );

    const rows = await penaltyLedgerRows(penalty.id, driver.id);
    assert.equal(rows.filter((row) => row.txnType === TxnType.PENALTY).length, 1);
    assert.equal(rows.filter((row) => row.txnType === TxnType.ADJUSTMENT).length, 1);
    assert.equal(await LedgerService.getBalance('DRIVER', driver.id), 0);
  });

  test('concurrent cancels produce one winner, one 409, and one reversal', async () => {
    const driver = await mkDriver();
    const penalty = await mkPenalty(driver.id, 610_000);

    let releaseDriverLock!: () => void;
    let markDriverLockAcquired!: () => void;
    const driverLockAcquired = new Promise<void>((resolve) => {
      markDriverLockAcquired = resolve;
    });
    const releaseLock = new Promise<void>((resolve) => {
      releaseDriverLock = resolve;
    });
    const blocker = db.transaction(async (tx) => {
      await LedgerService.lockEntity(tx, 'DRIVER', driver.id);
      markDriverLockAcquired();
      await releaseLock;
    });
    await driverLockAcquired;

    let raceSettled = false;
    const race = Promise.allSettled([
      cancelPenalty(penalty.id, `Q23 race ${suffix} A`),
      cancelPenalty(penalty.id, `Q23 race ${suffix} B`),
    ]).finally(() => {
      raceSettled = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(
      raceSettled,
      false,
      'both cancels must remain blocked inside the shared cancel critical section before the ledger lock is released',
    );

    releaseDriverLock();
    await blocker;

    const results = await race;
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected') as PromiseRejectedResult[];

    assert.equal(fulfilled.length, 1, `expected 1 cancel winner, got ${fulfilled.length}`);
    assert.equal(rejected.length, 1, `expected 1 cancel loser, got ${rejected.length}`);
    assert.equal((rejected[0].reason as Error & { statusCode?: number }).statusCode, 409);

    const rows = await penaltyLedgerRows(penalty.id, driver.id);
    assert.equal(rows.filter((row) => row.txnType === TxnType.PENALTY).length, 1);
    assert.equal(rows.filter((row) => row.txnType === TxnType.ADJUSTMENT).length, 1);
    assert.equal(rows.at(-1)?.balance, '0');
  });
});
