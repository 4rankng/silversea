import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, lte, or } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import type { Tx } from './trip-shared';
import {
  captureTripGpsTrack,
  deriveRoutesForStoredTrip,
  type CaptureResult,
} from './gps/capture.service';

type JobRow = typeof s.tripGpsCaptureJobs.$inferSelect;

interface GpsJobDependencies {
  now?: () => Date;
  capture?: (tripId: number) => Promise<CaptureResult>;
  derive?: (tripId: number) => Promise<{ legsDerived: number; legsTotal: number }>;
  leaseMs?: number;
}

export async function enqueueTripGpsCaptureJob(
  tx: Tx,
  input: { governanceActionId: number; tripId: number },
): Promise<void> {
  await tx.insert(s.tripGpsCaptureJobs).values({
    governanceActionId: input.governanceActionId,
    tripId: input.tripId,
    status: 'PENDING',
  }).onConflictDoNothing({
    target: s.tripGpsCaptureJobs.governanceActionId,
  });
}

function retryAt(now: Date, attemptCount: number): Date {
  const delayMs = Math.min(60 * 60_000, Math.max(30_000, 30_000 * (2 ** Math.min(attemptCount, 7))));
  return new Date(now.getTime() + delayMs);
}

async function markRetry(job: JobRow, leaseToken: string, error: string, now: Date): Promise<JobRow> {
  const [updated] = await db.update(s.tripGpsCaptureJobs).set({
    status: 'RETRY',
    nextAttemptAt: retryAt(now, job.attemptCount),
    leaseToken: null,
    leaseExpiresAt: null,
    lastError: error.slice(0, 1000),
    updatedAt: now,
  }).where(and(
    eq(s.tripGpsCaptureJobs.id, job.id),
    eq(s.tripGpsCaptureJobs.status, 'RUNNING'),
    eq(s.tripGpsCaptureJobs.leaseToken, leaseToken),
  )).returning();
  return updated ?? job;
}

export async function processTripGpsCaptureJobForAction(
  governanceActionId: number,
  dependencies: GpsJobDependencies = {},
): Promise<JobRow | null> {
  const now = dependencies.now?.() ?? new Date();
  const leaseMs = dependencies.leaseMs ?? 5 * 60_000;
  const leaseToken = randomUUID();
  const claimed = await db.transaction(async (tx) => {
    const [job] = await tx.select().from(s.tripGpsCaptureJobs)
      .where(eq(s.tripGpsCaptureJobs.governanceActionId, governanceActionId))
      .limit(1)
      .for('update');
    if (!job) return null;
    if (job.status === 'SUCCEEDED') return job;
    if (
      job.status === 'RUNNING'
      && job.leaseExpiresAt
      && job.leaseExpiresAt.getTime() > now.getTime()
    ) {
      return job;
    }
    if (
      job.status === 'RETRY'
      && job.nextAttemptAt.getTime() > now.getTime()
    ) {
      return job;
    }
    const [running] = await tx.update(s.tripGpsCaptureJobs).set({
      status: 'RUNNING',
      attemptCount: job.attemptCount + 1,
      leaseToken,
      leaseExpiresAt: new Date(now.getTime() + leaseMs),
      lastError: null,
      updatedAt: now,
    }).where(eq(s.tripGpsCaptureJobs.id, job.id)).returning();
    return running ?? null;
  });
  if (!claimed || claimed.status !== 'RUNNING' || claimed.leaseToken !== leaseToken) {
    return claimed;
  }

  const capture = dependencies.capture ?? captureTripGpsTrack;
  const derive = dependencies.derive ?? deriveRoutesForStoredTrip;
  try {
    const captured = await capture(claimed.tripId);
    if (captured.status !== 'ok') {
      return markRetry(
        claimed,
        leaseToken,
        `capture:${captured.errorKind ?? captured.status}`,
        now,
      );
    }
    const derived = await derive(claimed.tripId);
    if (captured.legsTotal > 0 && derived.legsDerived === 0) {
      return markRetry(claimed, leaseToken, 'derive:no_matched_legs', now);
    }
    const [succeeded] = await db.update(s.tripGpsCaptureJobs).set({
      status: 'SUCCEEDED',
      leaseToken: null,
      leaseExpiresAt: null,
      lastError: null,
      completedAt: now,
      updatedAt: now,
    }).where(and(
      eq(s.tripGpsCaptureJobs.id, claimed.id),
      eq(s.tripGpsCaptureJobs.status, 'RUNNING'),
      eq(s.tripGpsCaptureJobs.leaseToken, leaseToken),
    )).returning();
    return succeeded ?? claimed;
  } catch (error) {
    return markRetry(
      claimed,
      leaseToken,
      `exception:${error instanceof Error ? error.message : String(error)}`,
      now,
    );
  }
}

export async function processPendingTripGpsCaptureJobs(
  limit = 25,
  dependencies: GpsJobDependencies = {},
): Promise<JobRow[]> {
  const now = dependencies.now?.() ?? new Date();
  const jobs = await db.select({ governanceActionId: s.tripGpsCaptureJobs.governanceActionId })
    .from(s.tripGpsCaptureJobs)
    .where(or(
      and(
        inArray(s.tripGpsCaptureJobs.status, ['PENDING', 'RETRY']),
        lte(s.tripGpsCaptureJobs.nextAttemptAt, now),
      ),
      and(
        eq(s.tripGpsCaptureJobs.status, 'RUNNING'),
        or(
          isNull(s.tripGpsCaptureJobs.leaseExpiresAt),
          lte(s.tripGpsCaptureJobs.leaseExpiresAt, now),
        ),
      ),
    ))
    .limit(Math.max(1, Math.min(limit, 100)));
  const results: JobRow[] = [];
  for (const job of jobs) {
    const result = await processTripGpsCaptureJobForAction(
      job.governanceActionId,
      dependencies,
    );
    if (result) results.push(result);
  }
  return results;
}
