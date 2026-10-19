import { client } from '../../db';

/**
 * Cross-suite serialization for tests that own a PROCESS-GLOBAL singleton
 * (app_settings rows, the vat_config singleton + 'config:vat' cache, the
 * payroll-unit pin) or assert on COMPANY-WIDE aggregates (fund-book/169
 * convergence, whole-table counts).
 *
 * The backend integration suites all run against one shared dev database, and
 * parallel agent checkouts routinely run the same suite files at the same
 * instant. Within one `tsx --test --test-concurrency=1` run files are
 * sequential, but nothing serializes two RUNS against each other — a pinned
 * app_settings value flipped by run B mid-test of run A is exactly the class
 * of red that survives "fix" waves (readiness suddenly scopes to a foreign
 * unit, a singleton save lands between read-pairs, a quotation count moves).
 *
 * Session-level PostgreSQL advisory locks close that hole the same way
 * freight-pricing-config-routes.test.ts already serializes date allocation:
 * every suite that touches the shared resource takes the same lock for its
 * whole lifetime (before → after, including teardown writes), so concurrent
 * runs of the same files queue instead of interleaving. Locks die with the
 * session, so a crashed run can never wedge the suite.
 */
export type CrossSuiteLockRelease = () => Promise<void>;

export const CROSS_SUITE_LOCK_KEYS = {
  /** Writers of app_settings 'salary.payroll_business_unit_id' + readiness/close sweeps. */
  payrollUnit: [906_416, 1] as const,
  /** Writers/readers of the vat_config singleton and the 'config:vat' cache. */
  vatSingleton: [906_416, 2] as const,
} as const;

export async function acquireCrossSuiteLock(
  key: readonly [number, number],
): Promise<CrossSuiteLockRelease> {
  const [key1, key2] = key;
  const connection = await client.reserve();
  await connection`SELECT pg_advisory_lock(${key1}, ${key2})`;
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    try {
      await connection`SELECT pg_advisory_unlock(${key1}, ${key2})`;
    } finally {
      connection.release();
    }
  };
}
