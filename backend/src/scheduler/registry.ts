/**
 * Scheduler job registry (Wave 0).
 *
 * Pure data: a Map of job definitions. The runner (runner.ts) consumes this and
 * wires each job to node-cron. Kept separate so tests can assert registry
 * invariants and the lock-key derivation without booting cron or touching the DB.
 *
 * Later waves register real jobs:
 *   - Wave 2: email-send retry
 *   - Wave 3: receivable reminders (M5.7), salary-period close (M7.3)
 */

/** A registered cron job. `handler` is awaited; throws propagate to the runner. */
export interface SchedulerJob {
  /** Stable identifier; matches `scheduler_run_logs.job_name`. */
  name: string;
  /** 5-field cron expression (min hour dom month dow). */
  cron: string;
  /** Async function executed on each tick. */
  handler: () => Promise<void> | void;
  /** How many times to retry the handler on failure before giving up. Default 0. */
  retries?: number;
  /** Delay between retries, in ms. Default 30s. */
  retryDelayMs?: number;
  /** Skip scheduling (job still in registry for visibility). Default false. */
  disabled?: boolean;
}

const registry = new Map<string, SchedulerJob>();

/**
 * Register a job. Idempotent on `name` — re-registering replaces the prior
 * definition (useful in tests and in `tsx watch` restarts).
 */
export function registerJob(job: SchedulerJob): void {
  if (!job.name) throw new Error('Scheduler job requires a name');
  if (!/^[a-z0-9_-]+$/i.test(job.name)) {
    throw new Error(`Scheduler job name "${job.name}" must be [A-Za-z0-9_-]+`);
  }
  registry.set(job.name, job);
}

/** Get a registered job by name (undefined if not registered). */
export function getJob(name: string): SchedulerJob | undefined {
  return registry.get(name);
}

/** Snapshot of all registered jobs. */
export function listJobs(): SchedulerJob[] {
  return Array.from(registry.values());
}

/** Clear the registry (test-only). */
export function clearRegistry(): void {
  registry.clear();
}

/**
 * Stable 32-bit advisory-lock key derived from the job name. Same name → same
 * key across processes, so two backend pods running the same job race for the
 * same lock and only one wins. Returns a positive int32 fitting Postgres
 * `pg_try_advisory_lock(int)`.
 */
export function advisoryLockKey(jobName: string): number {
  // FNV-1a 32-bit. Stable, dependency-free, well-distributed for short strings.
  let h = 0x811c9dc5;
  for (let i = 0; i < jobName.length; i++) {
    h ^= jobName.charCodeAt(i);
    // h *= 16777619, keeping it 32-bit.
    h = Math.imul(h, 0x01000193);
  }
  // Postgres advisory-lock int is int4 (signed). Force positive via >>> 0 then
  // clamp to int32-max so we never pass a negative key that could collide with
  // the lock namespace used elsewhere.
  return (h >>> 0) % 0x7fffffff;
}
