// STEP 1.4 (card 20260916_14) — the stale-RUNNING sweeper and the per-job
// max-tick policy close the documented Wave-0 limitation (runner.ts header:
// no max-tick-time policy, RUNNING rows older than N minutes never swept).
// Sweeper behavior is DB-backed (insert a stale RUNNING row → sweep → FAILED);
// the max-tick helper is pure.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';

import { inArray } from 'drizzle-orm';

import { db, client } from '../../db';
import { sweepStaleRunningRows, withMaxTick, STALE_RUNNING_ERROR } from '../../scheduler/runner';
import * as s from '../../db/schema';

const stamp = `sweep-${Date.now()}`;

async function seedRun(status: 'RUNNING' | 'SUCCESS' | 'FAILED', startedMinutesAgo: number): Promise<number> {
  const [row] = await db.insert(s.schedulerRunLogs).values({
    jobName: stamp,
    cron: '* * * * *',
    status,
    attempt: 1,
    startedAt: new Date(Date.now() - startedMinutesAgo * 60_000),
  }).returning();
  return row.id;
}

describe('scheduler stale-RUNNING sweeper', () => {
  const insertedIds: number[] = [];

  before(async () => {
    insertedIds.push(await seedRun('RUNNING', 20));  // stale → must be swept
    insertedIds.push(await seedRun('RUNNING', 2));   // fresh → must survive
    insertedIds.push(await seedRun('SUCCESS', 20));  // terminal → untouched
  });

  after(async () => {
    await db.delete(s.schedulerRunLogs).where(inArray(s.schedulerRunLogs.id, insertedIds));
  });

  test('sweeps RUNNING rows older than the threshold to FAILED with the sweep error', async () => {
    const swept = await sweepStaleRunningRows(client, 15 * 60_000);
    assert.ok(swept >= 1, `expected at least the seeded stale row, swept=${swept}`);
    const [stale] = await db.select().from(s.schedulerRunLogs).where(inArray(s.schedulerRunLogs.id, [insertedIds[0]]));
    assert.equal(stale.status, 'FAILED');
    assert.equal(stale.error, STALE_RUNNING_ERROR);
    assert.ok(stale.endedAt, 'swept row must carry ended_at');
  });

  test('leaves fresh RUNNING rows and terminal rows untouched', async () => {
    const [fresh] = await db.select().from(s.schedulerRunLogs).where(inArray(s.schedulerRunLogs.id, [insertedIds[1]]));
    assert.equal(fresh.status, 'RUNNING');
    const [done] = await db.select().from(s.schedulerRunLogs).where(inArray(s.schedulerRunLogs.id, [insertedIds[2]]));
    assert.equal(done.status, 'SUCCESS');
  });
});

describe('per-job max-tick policy', () => {
  test('withMaxTick passes the handler result through when no limit is set', async () => {
    const value = await withMaxTick(async () => 'ok');
    assert.equal(value, 'ok');
  });

  test('withMaxTick rejects when the handler exceeds maxTickMs', async () => {
    await assert.rejects(
      () => withMaxTick(() => new Promise((resolve) => setTimeout(resolve, 200)), 30),
      /maxTickMs 30 exceeded/,
    );
  });

  test('withMaxTick resolves when the handler finishes inside the window', async () => {
    const value = await withMaxTick(async () => 'fast', 5_000);
    assert.equal(value, 'fast');
  });
});
