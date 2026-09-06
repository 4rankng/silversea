/**
 * Retention sweeps for high-churn tables (DB lean-down).
 *
 * The scheduler registry (backend/src/index.ts) runs `retention-daily` at
 * 03:15. Each sweep deletes expired rows in bounded batches so a first run
 * against months of backlog converges without long table locks.
 *
 * Policy (days, evaluated against now()):
 *   notifications           read > 30d OR any > 180d
 *   scheduler_run_logs      started > 30d
 *   durable_effect_jobs     SUCCEEDED and created > 30d
 *   master_import_row_results created > 90d
 *
 * Never purged: audit_logs (append-only mandate) and idempotency_keys
 * (double-submit guard; documented retention = forever).
 */
import { and, eq, inArray, lt, or, sql } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';

/** Rows removed per DELETE. 5k keeps each statement short on the shared dev/prod instance. */
const BATCH_SIZE = 5_000;
/** Hard stop per table per sweep (200 × 5k = 1M rows). Guards against runaway loops. */
const MAX_BATCHES = 200;

export interface RetentionSweepResult {
  table: string;
  deleted: number;
}

/**
 * Delete rows matching `predicate` in id-bounded batches. Selecting ids first
 * (instead of DELETE ... WHERE directly) is what allows LIMIT per batch —
 * Postgres DELETE has no LIMIT. Returns the number of rows actually removed.
 */
async function deleteInBatches(
  table: PgTable,
  idColumn: AnyPgColumn,
  predicate: SQL | undefined,
): Promise<number> {
  let deleted = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const idSelection = db.select({ id: idColumn }).from(table).where(predicate).limit(BATCH_SIZE);
    const removed = await db.delete(table).where(inArray(idColumn, idSelection)).returning({ id: idColumn });
    deleted += removed.length;
    if (removed.length < BATCH_SIZE) break;
  }
  return deleted;
}

/** Notifications: read rows age out after 30 days; everything after 180 days. */
export async function sweepNotifications(): Promise<RetentionSweepResult> {
  const predicate = or(
    and(
      eq(s.notifications.isRead, true),
      lt(s.notifications.createdAt, sql`now() - interval '30 days'`),
    ),
    lt(s.notifications.createdAt, sql`now() - interval '180 days'`),
  );
  const deleted = await deleteInBatches(s.notifications, s.notifications.id, predicate!);
  return { table: 'notifications', deleted };
}

/** Scheduler diagnostics: the heartbeat alone writes ~1,440 rows/day. */
export async function sweepSchedulerRunLogs(): Promise<RetentionSweepResult> {
  const deleted = await deleteInBatches(
    s.schedulerRunLogs,
    s.schedulerRunLogs.id,
    lt(s.schedulerRunLogs.startedAt, sql`now() - interval '30 days'`),
  );
  return { table: 'scheduler_run_logs', deleted };
}

/** Durable-effect outbox: completed jobs are historical; failures stay for forensics. */
export async function sweepDurableEffectJobs(): Promise<RetentionSweepResult> {
  const predicate = and(
    eq(s.durableEffectJobs.status, 'SUCCEEDED'),
    lt(s.durableEffectJobs.createdAt, sql`now() - interval '30 days'`),
  );
  const deleted = await deleteInBatches(s.durableEffectJobs, s.durableEffectJobs.id, predicate!);
  return { table: 'durable_effect_jobs', deleted };
}

/** Master-import row diagnostics: tied to batches, kept one quarter. */
export async function sweepMasterImportRowResults(): Promise<RetentionSweepResult> {
  const deleted = await deleteInBatches(
    s.masterImportRowResults,
    s.masterImportRowResults.id,
    lt(s.masterImportRowResults.createdAt, sql`now() - interval '90 days'`),
  );
  return { table: 'master_import_row_results', deleted };
}

/** Run every sweep. Ordered by expected volume (largest first). */
export async function runRetentionSweeps(): Promise<RetentionSweepResult[]> {
  return [
    await sweepNotifications(),
    await sweepSchedulerRunLogs(),
    await sweepDurableEffectJobs(),
    await sweepMasterImportRowResults(),
  ];
}
