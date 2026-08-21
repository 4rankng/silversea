/**
 * Scheduler runner (Wave 0).
 *
 * Boots every registered, non-disabled job onto node-cron. On each tick:
 *   1. Reserve a single connection from the postgres.js pool (postgres.js
 *      dispatches each query to whichever pooled connection is free, so a
 *      session-scoped advisory lock MUST run on the same connection as its
 *      unlock — `reserve()` pins one connection for the whole tick).
 *   2. Acquire `pg_try_advisory_lock(key)` on that reserved connection.
 *      If the lock is held by another instance, bail fast — no row written,
 *      the winning instance logs the run.
 *   3. Insert a `scheduler_run_logs` row at RUNNING.
 *   4. Run the handler (with retries + retry-delay on failure), writing the
 *      current `attempt` to the row on every attempt.
 *   5. Update the row to SUCCESS or FAILED + error text + endedAt.
 *   6. Release the advisory lock and free the reserved connection in `finally`.
 *
 * Known limitation (Wave 0): `stopScheduler` cancels future firings but does
 * NOT await an in-flight tick — Wave 2/3 jobs that hold the lock across
 * long-running work (HTTP calls, retries) should add a max-tick-time policy
 * and a sweeper that marks RUNNING rows older than N minutes as FAILED.
 *
 * Wave 2 (email retries) and Wave 3 (receivable reminders, salary-period close)
 * will register jobs against this runner.
 */
import cron from 'node-cron';
import logger from '../lib/logger';
import {
  advisoryLockKey,
  listJobs,
  type SchedulerJob,
} from './registry';

interface ScheduledHandle {
  job: SchedulerJob;
  task: ReturnType<typeof cron.schedule>;
}

const scheduled: ScheduledHandle[] = [];
const inFlight = new Set<Promise<void>>();
let started = false;

/**
 * Boot every registered, non-disabled job onto node-cron. Idempotent — calling
 * twice is a no-op (logs a warning). Call `stopScheduler()` to tear down.
 */
export function startScheduler(): void {
  if (started) {
    logger.warn('scheduler already started — ignoring duplicate startScheduler()');
    return;
  }
  const jobs = listJobs().filter((j) => !j.disabled);
  for (const job of jobs) {
    // node-cron v4 accepts both 5- and 6-field expressions; the registry's
    // contract is 5-field. Reject 6-field explicitly so `'0 9 * * * *'` (which
    // would fire every second during hour 9) is caught at boot, not in prod.
    const fieldCount = job.cron.trim().split(/\s+/).length;
    if (fieldCount !== 5) {
      logger.error(
        { job: job.name, cron: job.cron, fieldCount },
        'scheduler: cron must be 5-field — skipping',
      );
      continue;
    }
    if (!cron.validate(job.cron)) {
      logger.error({ job: job.name, cron: job.cron }, 'scheduler: invalid cron expression — skipping');
      continue;
    }
    const task = cron.schedule(job.cron, () => {
      // Track the in-flight tick so shutdown can await it before dbClient.end().
      const p = runJobTick(job).catch((err) => {
        // Should never happen — runJobTick captures its own errors — but if it
        // does, we want a loud log, not a silent swallow.
        logger.error({ job: job.name, err: err?.message ?? String(err) }, 'scheduler: tick scheduler threw');
      });
      inFlight.add(p);
      p.finally(() => inFlight.delete(p));
    });
    scheduled.push({ job, task });
    logger.info({ job: job.name, cron: job.cron }, 'scheduler: scheduled');
  }
  started = true;
  logger.info({ count: scheduled.length }, 'scheduler started');
}

/**
 * Stop all scheduled tasks and await in-flight ticks (up to `drainMs` ms) so
 * `dbClient.end()` doesn't terminate a handler mid-statement. Safe to call when
 * not started (no-op).
 */
export async function stopScheduler(drainMs = 10_000): Promise<void> {
  for (const h of scheduled) h.task.stop();
  scheduled.length = 0;
  started = false;
  if (inFlight.size > 0) {
    logger.info({ count: inFlight.size, drainMs }, 'scheduler: awaiting in-flight ticks');
    await Promise.race([
      Promise.allSettled([...inFlight]),
      sleep(drainMs),
    ]);
  }
  logger.info('scheduler stopped');
}

/**
 * Run a single job tick with advisory-lock + audit-log. Exported for tests.
 *
 * The advisory lock is held for the duration of the handler and released in a
 * `finally` block. If the lock can't be acquired (another instance is running),
 * the tick returns immediately with no log row — the winning instance logs.
 */
export async function runJobTick(job: SchedulerJob): Promise<void> {
  const lockKey = advisoryLockKey(job.name);

  // Reserve a single pooled connection so the session-scoped advisory lock
  // and its unlock hit the SAME Postgres backend. Without `reserve()`,
  // postgres.js dispatches each query to an arbitrary idle connection, and the
  // unlock would return `false` against a different session — leaking the lock
  // until the original connection is recycled.
  // Keep the database client lazy: the pure retry helpers in this module are
  // unit-tested without a database, and importing the client eagerly keeps a
  // postgres.js handle open after those tests finish.
  const { client: dbClient } = await import('../db/index.js');
  const conn = await dbClient.reserve();

  // pg_try_advisory_lock returns a Postgres boolean, which postgres.js parses
  // to a JS boolean.
  const lockResult = await conn`SELECT pg_try_advisory_lock(${lockKey}) AS acquired`;
  const acquired = lockResult[0]?.acquired === true;
  if (!acquired) {
    // Another instance won the lock — let it run. Not an error; common under
    // rolling deploys. Free the reserved connection and bail.
    await conn.release();
    logger.debug({ job: job.name }, 'scheduler: lock held by another instance — skipping');
    return;
  }

  // Insert RUNNING row. Uses the reserved connection so the row's `started_at`
  // comes from the same DB session as the lock (and the handler's writes, if
  // any) — important for log correlation under load.
  const [row] = await conn`
    INSERT INTO scheduler_run_logs (job_name, cron, status, attempt)
    VALUES (${job.name}, ${job.cron}, 'RUNNING', 1)
    RETURNING id
  `;
  const logId: number = row!.id;

  const maxAttempts = (job.retries ?? 0) + 1;
  const retryDelayMs = job.retryDelayMs ?? 30_000;

  try {
    // Delegate retry + attempt-stamping to the pure helper, with a writer that
    // routes each status update back through the reserved connection. Keeping
    // the helper DB-free makes the attempt-counting behavior unit-testable.
    const outcome = await executeWithRetries(
      job.handler,
      maxAttempts,
      retryDelayMs,
      async (status, attempt, error) => {
        if (status === 'SUCCESS') {
          await conn`
            UPDATE scheduler_run_logs
            SET status = 'SUCCESS', attempt = ${attempt}, ended_at = now()
            WHERE id = ${logId}
          `;
        } else if (status === 'ATTEMPT') {
          await conn`UPDATE scheduler_run_logs SET attempt = ${attempt} WHERE id = ${logId}`;
        } else {
          await conn`
            UPDATE scheduler_run_logs
            SET status = 'FAILED', attempt = ${attempt},
                ended_at = now(), error = ${error ?? null}
            WHERE id = ${logId}
          `;
        }
      },
    );

    if (outcome.status === 'SUCCESS') {
      logger.info({ job: job.name, attempt: outcome.attempt }, 'scheduler: job succeeded');
    } else {
      logger.error(
        { job: job.name, err: outcome.error },
        'scheduler: job failed after retries',
      );
    }
  } finally {
    // Always release the lock and the connection, even if an UPDATE above
    // threw. Session-scoped lock frees on connection close as a safety net.
    try {
      await conn`SELECT pg_advisory_unlock(${lockKey})`;
    } catch (unlockErr) {
      logger.warn({ job: job.name, err: errMsg(unlockErr) }, 'scheduler: failed to release advisory lock');
    }
    try {
      await conn.release();
    } catch (releaseErr) {
      logger.warn({ job: job.name, err: errMsg(releaseErr) }, 'scheduler: failed to release reserved connection');
    }
  }
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/**
 * Pure retry loop, factored out of `runJobTick` so the attempt-counting
 * behavior is unit-testable without a database.
 *
 * - Calls `handler()` up to `maxAttempts` times.
 * - On each attempt, calls `write('ATTEMPT', attempt)` BEFORE running the
 *   handler (so the audit row reflects "we are about to try attempt N").
 * - On success: calls `write('SUCCESS', attempt)` once and returns SUCCESS.
 * - On exhaustion: calls `write('FAILED', maxAttempts, errMsg)` once and
 *   returns FAILED.
 * - Sleeps `retryDelayMs` between failed attempts (not after the last one).
 *
 * The writer is best-effort: a writer throw is caught and logged (the run-log
 * is a side-channel; a stuck writer must not mask the handler outcome).
 */
export type RetryOutcome =
  | { status: 'SUCCESS'; attempt: number }
  | { status: 'FAILED'; attempt: number; error: string };

export async function executeWithRetries(
  handler: () => Promise<void> | void,
  maxAttempts: number,
  retryDelayMs: number,
  write: (status: 'ATTEMPT' | 'SUCCESS' | 'FAILED', attempt: number, error?: string) => Promise<void>,
): Promise<RetryOutcome> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await safeWrite(write, 'ATTEMPT', attempt);
    try {
      await handler();
      await safeWrite(write, 'SUCCESS', attempt);
      return { status: 'SUCCESS', attempt };
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        logger.warn(
          { attempt, err: errMsg(err) },
          'scheduler: job failed — retrying',
        );
        await sleep(retryDelayMs);
      }
    }
  }
  const errMsgVal = errMsg(lastError);
  await safeWrite(write, 'FAILED', maxAttempts, errMsgVal);
  return { status: 'FAILED', attempt: maxAttempts, error: errMsgVal };
}

async function safeWrite(
  write: (status: 'ATTEMPT' | 'SUCCESS' | 'FAILED', attempt: number, error?: string) => Promise<void>,
  status: 'ATTEMPT' | 'SUCCESS' | 'FAILED',
  attempt: number,
  error?: string,
): Promise<void> {
  try {
    await write(status, attempt, error);
  } catch (writeErr) {
    logger.warn(
      { status, attempt, err: errMsg(writeErr) },
      'scheduler: run-log write failed — outcome preserved',
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
