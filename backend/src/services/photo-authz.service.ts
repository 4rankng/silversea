import { db } from '../db';
import * as s from '../db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { Role } from '@tingting/shared';

/**
 * Ownership-scoped authorization for receipt photos served under the AMBIGUOUS
 * `expense-photos/<id>/` storage prefix.
 *
 * The prefix is shared by two independent serial sequences:
 *   - company receipts   → expense_photos        (keyed by expenses.id)
 *   - forwarder receipts → trip_expense_photos   (keyed by trip_expenses.id)
 *   - driver fuel OCR    → fuel_evidence_reviews (driver-owned source image)
 * These sequences can collide numerically, so a request CANNOT be authorized by
 * parsing the id from the path. This helper resolves the domain by EXACT
 * `storage_key` match against BOTH tables, then applies STRICTEST-MATCH: access
 * is granted only if the caller is authorized under EVERY table that holds the
 * key. (A full-key collision is near-impossible — keys embed Date.now()+ext —
 * but strictest-match is correct regardless and fail-closes on collision.)
 *
 * The requester's ACTIVE status is re-validated here for FORWARDER because the
 * `/api/photos` router sits behind `assetAuthMiddleware` (JWT sig + jti only),
 * NOT `resolveForwarder` — so a disabled forwarder with an unexpired JWT would
 * otherwise still read photos (ADR 0042, N5).
 *
 * Pure (no req/res) for unit-testability. Callers map decisions to HTTP:
 *   allow      → sendFile
 *   forbidden  → 403
 *   collision  → 403 (+ logger.warn — a both-tables match is a write-path
 *                integrity signal, not normal traffic)
 *   not_found  → 404
 */
export type PhotoAuthzReason = 'allowed' | 'forbidden' | 'collision' | 'not_found';
export interface PhotoAuthDecision {
  allow: boolean;
  reason: PhotoAuthzReason;
}

const FINANCE_ROLES: ReadonlySet<Role> = new Set([Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT]);

export type DriverTripPhotoAccess = 'owned' | 'no_profile' | 'not_owned';

/** Trip-photo access for DRIVERS. Distinguishes "no driver profile bound to
 * this user" from "profile exists but the trip is not assigned to it" so the
 * route can keep its two distinct 403 messages. */
export async function checkDriverTripPhotoAccess(
  userId: number,
  tripId: number,
): Promise<DriverTripPhotoAccess> {
  const [driver] = await db.select({ id: s.drivers.id }).from(s.drivers)
    .where(eq(s.drivers.userId, userId)).limit(1);
  if (!driver) return 'no_profile';
  const [trip] = await db.select({ id: s.trips.id }).from(s.trips)
    .where(and(eq(s.trips.id, tripId), eq(s.trips.driverId, driver.id)))
    .limit(1);
  return trip ? 'owned' : 'not_owned';
}

export async function authorizeExpensePhoto(
  storageKey: string,
  user: { userId: number; role: Role },
): Promise<PhotoAuthDecision> {
  // 1. Parallel exact-storage_key lookups against both receipt tables.
  const [tripRows, expenseRows, fuelRows] = await Promise.all([
    db.select({
      forwarderId: s.tripExpenses.forwarderId,
      ownerStatus: s.users.status,
      hasCurrentAssignment: sql<boolean>`EXISTS (
        SELECT 1
        FROM trips scoped_trip
        INNER JOIN user_shipment_links scoped_assignment
          ON scoped_assignment.shipment_id = scoped_trip.shipment_id
        WHERE scoped_trip.id = ${s.tripExpenses.tripId}
          AND scoped_assignment.user_id = ${user.userId}
      )`,
    })
      .from(s.tripExpensePhotos)
      .innerJoin(s.tripExpenses, eq(s.tripExpensePhotos.tripExpenseId, s.tripExpenses.id))
      // LEFT JOIN (not INNER, no status filter) so `tripMatch` stays a pure
      // existence test — finance roles must still see keys owned by a disabled
      // forwarder. The FORWARDER branch reads ownerStatus inline below (N5),
      // avoiding a second round-trip to re-probe ACTIVE.
      .leftJoin(s.users, eq(s.tripExpenses.forwarderId, s.users.id))
      .where(eq(s.tripExpensePhotos.storageKey, storageKey))
      .limit(1),
    db.select({ id: s.expensePhotos.id })
      .from(s.expensePhotos)
      .where(eq(s.expensePhotos.storageKey, storageKey))
      .limit(1),
    db.select({
      ownerUserId: s.fuelEvidenceReviews.ownerUserId,
      driverStatus: s.drivers.status,
      ownerUserStatus: s.users.status,
    })
      .from(s.fuelEvidenceReviews)
      .innerJoin(s.drivers, eq(s.fuelEvidenceReviews.ownerDriverId, s.drivers.id))
      .innerJoin(s.users, eq(s.fuelEvidenceReviews.ownerUserId, s.users.id))
      .where(eq(s.fuelEvidenceReviews.storageKey, storageKey))
      .limit(1),
  ]);

  const tripMatch = tripRows.length > 0;
  const expenseMatch = expenseRows.length > 0;
  const fuelMatch = fuelRows.length > 0;
  if (!tripMatch && !expenseMatch && !fuelMatch) return { allow: false, reason: 'not_found' };

  // 2. Per-table authorization, then 3. STRICTEST-MATCH: allow only if
  // authorized under every matching table.
  //   - trip side: finance always; FORWARDER must own the row AND the owner
  //     is ACTIVE (status folded into the lookup above, N5); DRIVER never.
  //     forwarderId is NULLABLE (accountants also create trip_expenses), so
  //     null !== userId denies an accountant-created receipt naturally.
  //   - expense side: finance only (company receipts are B1-confidential).
  const okTrip = !tripMatch
    || FINANCE_ROLES.has(user.role)
    || (user.role === Role.OPS
      && tripRows[0].forwarderId === user.userId
      && tripRows[0].ownerStatus === 'ACTIVE'
      && tripRows[0].hasCurrentAssignment);
  const okExpense = !expenseMatch || FINANCE_ROLES.has(user.role);
  const okFuel = !fuelMatch
    || FINANCE_ROLES.has(user.role)
    || (user.role === Role.DRIVER
      && fuelRows[0].ownerUserId === user.userId
      && fuelRows[0].driverStatus === 'ACTIVE'
      && fuelRows[0].ownerUserStatus === 'ACTIVE');
  const allow = okTrip && okExpense && okFuel;

  if (allow) return { allow: true, reason: 'allowed' };
  // A both-tables match that denies is a write-path integrity signal (N6).
  if ([tripMatch, expenseMatch, fuelMatch].filter(Boolean).length > 1) {
    return { allow: false, reason: 'collision' };
  }
  return { allow: false, reason: 'forbidden' };
}
