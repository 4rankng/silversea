/**
 * Scheduler barrel (Wave 0). Re-exports the registry + runner so callers
 * (`index.ts`, future waves, tests) import from a single path: `./scheduler`.
 */
export {
  registerJob,
  getJob,
  listJobs,
  clearRegistry,
  advisoryLockKey,
  type SchedulerJob,
} from './registry';
export {
  startScheduler,
  stopScheduler,
  runJobTick,
  executeWithRetries,
  type RetryOutcome,
} from './runner';
