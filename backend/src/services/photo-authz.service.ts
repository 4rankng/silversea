import { db } from '../db';
import type { Tx } from './trip-shared';
import * as s from '../db/schema';
import { and, eq, sql, or } from 'drizzle-orm';
import { hydrateExpenseAccountingSource } from './expense-accounting-source.service';
import { Role } from '@tingting/shared';
import { assertOpsExpenseAssignment } from './expense-owner-scope.service';
import { ApiError } from '../errors';

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
  executor: Tx | typeof db = db,
): Promise<DriverTripPhotoAccess> {
  const [driver] = await executor.select({ id: s.drivers.id }).from(s.drivers)
    .where(eq(s.drivers.userId, userId)).limit(1);
  if (!driver) return 'no_profile';
  const [trip] = await executor.select({ id: s.trips.id }).from(s.trips)
    .where(and(eq(s.trips.id, tripId), eq(s.trips.driverId, driver.id)))
    .limit(1);
  return trip ? 'owned' : 'not_owned';
}

export async function authorizeExpensePhoto(
  storageKey: string,
  user: { userId: number; role: Role },
  executor: Tx | typeof db = db,
): Promise<PhotoAuthDecision> {
  // 1. Parallel exact-storage_key lookups against both receipt tables.
  const [tripRows, expenseRows, fuelRows, driverRows, opsRows, accountingRows] = await Promise.all([
    executor.select({
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
    executor.select({ id: s.expensePhotos.id })
      .from(s.expensePhotos)
      .where(eq(s.expensePhotos.storageKey, storageKey))
      .limit(1),
    executor.select({
      ownerUserId: s.fuelEvidenceReviews.ownerUserId,
      driverStatus: s.drivers.status,
      ownerUserStatus: s.users.status,
    })
      .from(s.fuelEvidenceReviews)
      .innerJoin(s.drivers, eq(s.fuelEvidenceReviews.ownerDriverId, s.drivers.id))
      .innerJoin(s.users, eq(s.fuelEvidenceReviews.ownerUserId, s.users.id))
      .where(eq(s.fuelEvidenceReviews.storageKey, storageKey))
      .limit(1),
    executor.select({ ownerUserId: s.drivers.userId, driverStatus: s.drivers.status, ownerStatus: s.users.status,
      currentDriverId: s.trips.driverId, claimDriverId: s.driverIncidentalCosts.driverId }).from(s.driverIncidentalCosts)
      .innerJoin(s.drivers, eq(s.drivers.id, s.driverIncidentalCosts.driverId))
      .innerJoin(s.users, eq(s.users.id, s.drivers.userId)).innerJoin(s.trips, eq(s.trips.id, s.driverIncidentalCosts.tripId))
      .where(or(eq(s.driverIncidentalCosts.receiptStorageKey, storageKey), sql`${s.driverIncidentalCosts.photoStorageKeys} @> ${JSON.stringify([storageKey])}::jsonb`)),
    executor.select({ ownerUserId: s.opsExpenseEntries.paidById, ownerStatus: s.users.status, shipmentId: s.opsExpenseEntries.shipmentId })
      .from(s.opsExpensePhotos).innerJoin(s.opsExpenseEntries, eq(s.opsExpenseEntries.id, s.opsExpensePhotos.opsExpenseId))
      .innerJoin(s.users, eq(s.users.id, s.opsExpenseEntries.paidById)).where(eq(s.opsExpensePhotos.storageKey, storageKey)),
    executor.select({ source: s.expenseAccountingSources }).from(s.expenseAccountingEvidence)
      .innerJoin(s.expenseAccountingSources, eq(s.expenseAccountingSources.id, s.expenseAccountingEvidence.expenseAccountingSourceId))
      .where(eq(s.expenseAccountingEvidence.storageKey, storageKey)),
  ]);

  const tripMatch = tripRows.length > 0;
  const expenseMatch = expenseRows.length > 0;
  const fuelMatch = fuelRows.length > 0;
  if (!tripMatch && !expenseMatch && !fuelMatch && !driverRows.length && !opsRows.length && !accountingRows.length) return { allow: false, reason: 'not_found' };

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
  const okDriver = driverRows.every(row => FINANCE_ROLES.has(user.role) || (user.role === Role.DRIVER && row.ownerUserId === user.userId
    && row.ownerStatus === 'ACTIVE' && row.driverStatus === 'ACTIVE' && row.currentDriverId === row.claimDriverId));
  // Match the expense workflow's current scope: a manual link, active truck
  // assignment, or the user's saved expense. Cache per shipment for shared keys.
  const opsScopes = new Map<number, Promise<boolean>>();
  const canReadOpsShipment = (shipmentId: number) => {
    let decision = opsScopes.get(shipmentId);
    if (!decision) {
      decision = assertOpsExpenseAssignment(executor, user.userId, shipmentId).then(() => true).catch((error: unknown) => {
        if (error instanceof ApiError && error.statusCode === 403) return false;
        throw error;
      });
      opsScopes.set(shipmentId, decision);
    }
    return decision;
  };
  const okOps = (await Promise.all(opsRows.map(async row => FINANCE_ROLES.has(user.role) || (user.role === Role.OPS && row.ownerUserId === user.userId
    && row.ownerStatus === 'ACTIVE' && await canReadOpsShipment(row.shipmentId))))).every(Boolean);
  let okAccounting = true;
  for (const match of accountingRows) {
    if (FINANCE_ROLES.has(user.role)) continue;
    const source = await hydrateExpenseAccountingSource(executor, match.source);
    if ((source.payerUserId !== user.userId && source.recordedById !== user.userId) || ![Role.OPS, Role.DRIVER].includes(user.role)) { okAccounting = false; continue; }
    if (user.role === Role.DRIVER) okAccounting = okAccounting && source.tripId != null && (await checkDriverTripPhotoAccess(user.userId, source.tripId, executor)) === 'owned';
    if (user.role === Role.OPS) {
      const [owner] = await executor.select({ status: s.users.status }).from(s.users).where(eq(s.users.id, user.userId)).limit(1);
      okAccounting = okAccounting && owner?.status === 'ACTIVE' && await canReadOpsShipment(source.shipmentId);
    }
  }
  const allow = okTrip && okExpense && okFuel && okDriver && okOps && okAccounting;

  if (allow) return { allow: true, reason: 'allowed' };
  // A both-tables match that denies is a write-path integrity signal (N6).
  if ([tripMatch, expenseMatch, fuelMatch, driverRows.length > 0, opsRows.length > 0, accountingRows.length > 0].filter(Boolean).length > 1) {
    return { allow: false, reason: 'collision' };
  }
  return { allow: false, reason: 'forbidden' };
}
