import { sql } from 'drizzle-orm';
import type { Executor } from './trip-shared';

// Shared serialization authority for a trip crossing the editable/issued
// financial boundary. Every participant acquires keys in ascending trip order.
export const TRIP_FINANCIAL_AUTHORITY_LOCK_NAMESPACE = 6118;

export async function lockTripFinancialAuthority(
  executor: Executor,
  tripIds: readonly number[],
): Promise<void> {
  const orderedTripIds = [...new Set(tripIds)].sort((left, right) => left - right);
  for (const tripId of orderedTripIds) {
    await executor.execute(sql`
      SELECT pg_advisory_xact_lock(
        ${TRIP_FINANCIAL_AUTHORITY_LOCK_NAMESPACE},
        ${tripId}
      )
    `);
  }
}
