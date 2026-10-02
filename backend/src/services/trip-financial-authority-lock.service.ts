// Shared serialization authority for a trip crossing the editable/issued
// financial boundary (family 6118 in the advisory-lock module). Kept as its
// own export because a dozen financial writers sequence through it; every
// participant acquires keys in ascending trip order via the module's
// canonical ordering.
import { acquireAdvisoryLocks, lockKeys, LOCK_FAMILY } from './advisory-lock.service';
import type { Executor } from '../db';

export const TRIP_FINANCIAL_AUTHORITY_LOCK_NAMESPACE = LOCK_FAMILY.tripFinancialAuthority;

export async function lockTripFinancialAuthority(
  executor: Executor,
  tripIds: readonly number[],
): Promise<void> {
  await acquireAdvisoryLocks(executor, tripIds.map(lockKeys.tripFinancialAuthority));
}
