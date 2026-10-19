// Cross-process serialization for suites that mutate a SHARED GLOBAL row —
// app_settings 'salary.payroll_business_unit_id' (payroll readiness scope)
// and the vat_config singleton — while the concurrent full-suite run executes
// test files in parallel processes. The classic before → tests → after
// pin/restore of a global races with sibling files: one suite's restore can
// repoint the global at a unit another suite already deleted, surfacing as
// 404 "Không tìm thấy lái xe ..." / 409 "Đơn vị tính lương đã cấu hình không
// còn hoạt động" (and the vat-config 428/0.08-class reds) that never
// reproduce under the sequential gate. A session-level Postgres advisory lock
// held for the whole file — the same pattern as the fuel-date reservation in
// freight-pricing-config-routes.test.ts — serializes exactly the writers,
// leaves unrelated files parallel, and self-releases on process exit.
// Test isolation only; never imported from production code.
import { client } from '../../db';

/** Shared classid for every suite lock (one namespace, one slot per resource). */
export const SUITE_LOCK_NAMESPACE = 906415;

/** Slot 1 is the freight fuel-date reservation inside its own test file. */
export const SALARY_PAYROLL_UNIT_SCOPE_LOCK = 2;
export const VAT_CONFIG_SINGLETON_LOCK = 3;

export type SuiteLock = Awaited<ReturnType<typeof client.reserve>>;

const LOCK_TIMEOUT = '120s';

/**
 * Reserve one pooled connection and hold the namespace/slot advisory lock on
 * it until releaseSuiteLock. The bounded lock_timeout turns a leaked holder
 * into a loud suite failure instead of a hung run; a holder that exits for
 * any reason frees the lock with its session.
 */
export async function acquireSuiteLock(slot: number): Promise<SuiteLock> {
  const reserved = await client.reserve();
  try {
    await reserved`SELECT set_config('lock_timeout', ${LOCK_TIMEOUT}, false)`;
    await reserved`SELECT pg_advisory_lock(${SUITE_LOCK_NAMESPACE}, ${slot})`;
    return reserved;
  } catch (error) {
    reserved.release();
    throw error;
  }
}

/** Release the lock and the reserved connection. Safe to call once. */
export async function releaseSuiteLock(lock: SuiteLock | undefined, slot: number): Promise<void> {
  if (!lock) return;
  try {
    await lock`SELECT pg_advisory_unlock(${SUITE_LOCK_NAMESPACE}, ${slot})`;
  } catch (error) {
    // Session teardown frees the lock regardless — never block the caller's
    // client.end() on a dead reserved connection.
    console.warn('[suite-serial-lock] unlock failed (session teardown frees it):',
      (error as Error).message);
  } finally {
    lock.release();
  }
}
