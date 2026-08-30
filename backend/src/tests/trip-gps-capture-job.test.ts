/**
 * GPS capture-job read/write path (P6): enqueue idempotency and the leased
 * processing state machine (PENDING → RUNNING → SUCCEEDED/RETRY). Real GPS
 * fetch is injected; gps.service.test.ts covers the fetch helpers.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';
import { db, client } from '../db';
import * as s from '../db/schema';
import {
  enqueueTripGpsCaptureJob,
  processPendingTripGpsCaptureJobs,
  processTripGpsCaptureJobForAction,
} from '../services/trip-gps-capture-job.service';

const GOVERNANCE_ACTION_IDS = [9_000_001, 9_000_002, 9_000_003, 9_000_004, 9_000_005, 9_000_006];
let tripSeq = 0;

function nextTripId(): number {
  tripSeq += 1;
  return 9_000_000 + tripSeq;
}

function mkJob(governanceActionId: number, tripId: number): Promise<void> {
  return db.transaction((tx) => enqueueTripGpsCaptureJob(tx, { governanceActionId, tripId }));
}

const OK_CAPTURE = (tripId: number) => Promise.resolve({
  tripId, status: 'ok' as const, pointCount: 5, legsDerived: 2, legsTotal: 2,
});

let tripA = 0;
let tripB = 0;
let tripC = 0;
let tripD = 0;

before(async () => {
  // governanceActionId is FK-free (unique on the column) → synthetic 9_000_000+
  // ids isolate runs without colliding with real governance-action serials.
  tripA = nextTripId();
  tripB = nextTripId();
  tripC = nextTripId();
  tripD = nextTripId();
  await mkJob(9_000_001, tripA);
  await mkJob(9_000_002, tripB);
  await mkJob(9_000_003, tripC);
  await mkJob(9_000_004, tripD);
});

after(async () => {
  try {
    await db.delete(s.tripGpsCaptureJobs).where(inArray(s.tripGpsCaptureJobs.governanceActionId, GOVERNANCE_ACTION_IDS));
  } catch (err) { console.warn('[gps-jobs] cleanup:', (err as Error).message); }
  await client.end();
});

describe('trip GPS capture job', () => {
  test('enqueue is idempotent per governance action and rejects a trip mismatch', async () => {
    await mkJob(9_000_001, tripA); // same action + same trip → no-op, no duplicate
    const rows = await db.select().from(s.tripGpsCaptureJobs)
      .where(eq(s.tripGpsCaptureJobs.governanceActionId, 9_000_001));
    assert.equal(rows.length, 1);

    await assert.rejects(
      db.transaction((tx) => enqueueTripGpsCaptureJob(tx, { governanceActionId: 9_000_001, tripId: tripB })),
      /tới chuyến khác/,
    );
  });

  test('PENDING → RUNNING → SUCCEEDED on a healthy capture', async () => {
    const job = await processTripGpsCaptureJobForAction(9_000_001, {
      capture: (id) => OK_CAPTURE(id),
      derive: () => Promise.resolve({ legsDerived: 2, legsTotal: 2 }),
    });
    assert.equal(job?.status, 'SUCCEEDED');
    assert.equal(job?.attemptCount, 1);
    assert.ok(job?.completedAt);
  });

  test('capture failure → RETRY with backoff and recorded error', async () => {
    const job = await processTripGpsCaptureJobForAction(9_000_002, {
      capture: () => Promise.resolve({ tripId: tripB, status: 'error' as never, pointCount: 0, legsDerived: 0, legsTotal: 0, errorKind: 'SENSOR_OFFLINE' }),
      derive: () => Promise.resolve({ legsDerived: 0, legsTotal: 0 }),
    });
    assert.equal(job?.status, 'RETRY');
    assert.match(job?.lastError ?? '', /capture:SENSOR_OFFLINE/);
    assert.equal(job?.attemptCount, 1);
    assert.ok(job?.nextAttemptAt.getTime() > Date.now());
  });

  test('derive failure with legs → RETRY (derive:no_matched_legs)', async () => {
    const job = await processTripGpsCaptureJobForAction(9_000_003, {
      capture: (id) => Promise.resolve({ tripId: id, status: 'ok' as const, pointCount: 3, legsDerived: 0, legsTotal: 4 }),
      derive: () => Promise.resolve({ legsDerived: 0, legsTotal: 4 }),
    });
    assert.equal(job?.status, 'RETRY');
    assert.equal(job?.lastError, 'derive:no_matched_legs');
  });

  test('RETRY not yet due → returned untouched (no attempt burn)', async () => {
    await db.update(s.tripGpsCaptureJobs).set({
      status: 'RETRY', lastError: 'capture:SENSOR_OFFLINE', nextAttemptAt: new Date(Date.now() + 60_000),
    }).where(eq(s.tripGpsCaptureJobs.governanceActionId, 9_000_004));
    const before = await db.select().from(s.tripGpsCaptureJobs)
      .where(eq(s.tripGpsCaptureJobs.governanceActionId, 9_000_004)).limit(1);
    const job = await processTripGpsCaptureJobForAction(9_000_004, {
      capture: (id) => OK_CAPTURE(id),
      derive: () => Promise.resolve({ legsDerived: 1, legsTotal: 1 }),
    });
    assert.equal(job?.status, 'RETRY');
    assert.equal(job?.attemptCount, 0);
    assert.equal(job?.nextAttemptAt.getTime(), before[0]!.nextAttemptAt.getTime());
  });

  test('RUNNING with an unexpired lease → returned untouched', async () => {
    await db.update(s.tripGpsCaptureJobs).set({
      status: 'RUNNING', attemptCount: 2, leaseToken: 'lease-x', leaseExpiresAt: new Date(Date.now() + 60_000),
    }).where(eq(s.tripGpsCaptureJobs.governanceActionId, 9_000_004));
    const job = await processTripGpsCaptureJobForAction(9_000_004, {
      capture: (id) => OK_CAPTURE(id),
      derive: () => Promise.resolve({ legsDerived: 1, legsTotal: 1 }),
    });
    assert.equal(job?.status, 'RUNNING');
    assert.equal(job?.leaseToken, 'lease-x');
    assert.equal(job?.attemptCount, 2);
  });

  test('processPendingTripGpsCaptureJobs drains PENDING jobs through the same machine', async () => {
    await mkJob(9_000_005, nextTripId());
    await mkJob(9_000_006, nextTripId());
    const processed = await processPendingTripGpsCaptureJobs(25, {
      capture: (id) => OK_CAPTURE(id),
      derive: () => Promise.resolve({ legsDerived: 1, legsTotal: 1 }),
    });
    const mine = processed.filter((job) => job.governanceActionId >= 9_000_005);
    assert.ok(mine.length >= 2);
    for (const job of mine) assert.equal(job.status, 'SUCCEEDED');
  });
});
