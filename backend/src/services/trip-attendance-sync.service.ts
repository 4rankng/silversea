// Trip Attendance Sync — Post-transaction attendance synchronization
// Best-effort sync outside the main transaction so attendance failures
// never block trip lifecycle changes.

import { TripStatus } from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';
import { eq } from 'drizzle-orm';
import { syncTripWorkDays, removeTripWorkDays } from './attendance.service';

const BUSINESS_TIME_ZONE = 'Asia/Ho_Chi_Minh';

export function toBusinessDateString(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

async function resolveCompletionDate(tripId: number, actualArrivalDate?: string | null): Promise<string | null> {
  const normalizedInput = toBusinessDateString(actualArrivalDate);
  if (normalizedInput) return normalizedInput;
  const [trip] = await db.select({ completedAt: s.trips.completedAt })
    .from(s.trips)
    .where(eq(s.trips.id, tripId))
    .limit(1);
  return toBusinessDateString(trip?.completedAt);
}

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
      const completionDate = newStatus === TripStatus.COMPLETED
        ? await resolveCompletionDate(tripId, actualArrivalDate ?? null)
        : actualArrivalDate ?? null;
      await syncTripWorkDays(driverId, tripId, departureDate, completionDate, userId ?? null);
    } else if (newStatus === TripStatus.CANCELED) {
      await removeTripWorkDays(driverId, tripId);
    }
  } catch (err) {
    // Log but don't throw — attendance sync failure must never block trip ops
    console.warn('[attendance] sync failed for trip', tripId, err);
  }
}
