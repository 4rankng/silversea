// Trip Attendance Sync — Post-transaction attendance synchronization
// Best-effort sync outside the main transaction so attendance failures
// never block trip lifecycle changes.

import { TripStatus } from '@tingting/shared';
import { syncTripWorkDays, removeTripWorkDays } from './attendance.service';

/**
 * Call this from routes/trips.ts after updateStatus resolves. Not inside the
 * transaction so a failed attendance write never blocks the lifecycle change.
 */
export async function syncAttendanceAfterStatusChange(
  tripId: number,
  newStatus: TripStatus,
  driverId: number | null,
  departureDate: string | null,
  actualArrivalDate?: string | null,
  userId?: number | null,
) {
  if (!driverId || !departureDate) return; // external carrier or missing data

  try {
    if (newStatus === TripStatus.IN_TRANSIT || newStatus === TripStatus.COMPLETED) {
      await syncTripWorkDays(driverId, tripId, departureDate, actualArrivalDate ?? null, userId ?? null);
    } else if (newStatus === TripStatus.CANCELED) {
      await removeTripWorkDays(driverId, tripId);
    }
  } catch (err) {
    // Log but don't throw — attendance sync failure must never block trip ops
    console.warn('[attendance] sync failed for trip', tripId, err);
  }
}
