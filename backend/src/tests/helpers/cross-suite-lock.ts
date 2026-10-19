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
  /**
   * Suites that hold an ACTIVE treasury account with a past `cutoverAt`
   * (the `hasActiveCutoverAt` window) vs every receive-without-account
   * caller of `POST /api/payments/receive` — a live cutover fixture makes
   * that call 422 `Phải chọn tài khoản tiền mặt/ngân hàng sau thời điểm
   * chuyển đổi kho quỹ`, which is exactly the standing q03 red under
   * file-parallel runs.
   */
  treasuryCutoverWindow: [906_416, 3] as const,
} as const;

/**
 * Bounded wait (the ported suite-serial-lock design): a leaked holder that is
 * still alive fails the waiting suite loudly after 120s instead of hanging the
 * run; a crashed holder frees the lock with its session. The timeout is reset
 * on release so the pooled connection never carries it into other queries.
 */
const LOCK_TIMEOUT_MS = '120s';

export async function acquireCrossSuiteLock(
  key: readonly [number, number],
): Promise<CrossSuiteLockRelease> {
  const [key1, key2] = key;
  const connection = await client.reserve();
  try {
    await connection`SELECT set_config('lock_timeout', ${LOCK_TIMEOUT_MS}, false)`;
    await connection`SELECT pg_advisory_lock(${key1}, ${key2})`;
  } catch (error) {
    connection.release();
    throw error;
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    try {
      await connection`SELECT pg_advisory_unlock(${key1}, ${key2})`;
      await connection`SELECT set_config('lock_timeout', '0', false)`;
    } finally {
      connection.release();
    }
  };
}
