import { db } from '../db';
import * as s from '../db/schema';
import { and, eq } from 'drizzle-orm';
import { Role, type GeotagInput, type GeotagEntityType, type PhotoGeotag } from '@tingting/shared';
import { ApiError } from '../errors';
import { lockApplicationOwnedUniqueness } from './application-owned-uniqueness.service';
import type { Tx } from './trip-shared';

/**
 * Event-driven mobile GPS geotagging — service layer.
 *
 * One geotag per (entityType, entityId): submitGeotag() upserts so resubmits
 * (flaky network, double-tap) never duplicate (idempotency, M0X-HT-04).
 * Ownership is resolved per entity type:
 *   - trip_photo        → DRIVER must own the trip (drivers.userId === caller);
 *                         finance roles (ADMIN/MANAGER/ACCOUNTANT) always pass.
 *   - trip_expense_photo→ FORWARDER must own the trip_expense (forwarderId ===
 *                         caller); finance roles always pass.
 *   - expense_photo     → finance roles only (company receipts).
 * A caller without ownership gets 404 (not 403) so existence doesn't leak —
 * same posture as photo-authz.service.ts.
 *
 * gpsAt freshness gate (ported from the payroll reference): reject fixes
 * >GPS_FRESHNESS_MAX_STALE_S old or >GPS_FRESHNESS_MAX_SKEW_S in the future.
 * Zero/undefined gpsAt (manual / no-device-fix entry) is allowed through.
 */

const FINANCE_ROLES: ReadonlySet<Role> = new Set([Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT]);

/** Max acceptable age of a device fix (seconds). */
export const GPS_FRESHNESS_MAX_STALE_S = 300;
/** Max acceptable clock skew — fix this far in the future is tolerated (seconds). */
export const GPS_FRESHNESS_MAX_SKEW_S = 60;

export interface AuthUserLike {
  userId: number;
  role: Role;
}

/** Reject stale / future device fixes. Zero/undefined = no fix → allow. */
export function validateGpsFreshness(gpsAtMs: number | undefined, now: number = Date.now()): void {
  if (!gpsAtMs || gpsAtMs <= 0) return;
  const ageS = (now - gpsAtMs) / 1000;
  if (ageS > GPS_FRESHNESS_MAX_STALE_S) {
    throw new ApiError(422, 'Vị trí GPS đã cũ, vui lòng lấy vị trí lại');
  }
  const skewS = (gpsAtMs - now) / 1000;
  if (skewS > GPS_FRESHNESS_MAX_SKEW_S) {
    throw new ApiError(422, 'Thời gian thiết bị không khớp, vui lòng kiểm tra giờ thiết bị');
  }
}

/**
 * Resolve whether `user` may geotag the referenced photo. Returns the DB row
 * projection needed for the upsert's ownership audit, or throws 404.
 * Pure (no req/res) for unit-testability — mirrors photo-authz.service.ts.
 */
export async function authorizeGeotag(
  entityType: GeotagEntityType,
  entityId: number,
  user: AuthUserLike,
  dbOrTx: typeof db | Tx = db,
): Promise<void> {
  // Office/finance roles may geotag any photo (they backfill + correct).
  if (FINANCE_ROLES.has(user.role)) return;

  if (entityType === 'trip_photo') {
    // trip_photos → trips → drivers (drivers.userId === caller for DRIVER).
    if (user.role !== Role.DRIVER) throw new ApiError(404, 'Không tìm thấy chứng từ');
    const [row] = await dbOrTx.select({ driverUserId: s.drivers.userId })
      .from(s.tripPhotos)
      .innerJoin(s.trips, eq(s.tripPhotos.tripId, s.trips.id))
      .innerJoin(s.drivers, eq(s.trips.driverId, s.drivers.id))
      .where(eq(s.tripPhotos.id, entityId))
      .limit(1);
    if (!row || row.driverUserId !== user.userId) throw new ApiError(404, 'Không tìm thấy chứng từ');
    return;
  }

  if (entityType === 'trip_expense_photo') {
    // trip_expense_photos → trip_expenses (forwarderId === caller for FORWARDER).
    if (user.role !== Role.FORWARDER) throw new ApiError(404, 'Không tìm thấy chứng từ');
    const [row] = await dbOrTx.select({ forwarderId: s.tripExpenses.forwarderId })
      .from(s.tripExpensePhotos)
      .innerJoin(s.tripExpenses, eq(s.tripExpensePhotos.tripExpenseId, s.tripExpenses.id))
      .where(eq(s.tripExpensePhotos.id, entityId))
      .limit(1);
    if (!row || row.forwarderId !== user.userId) throw new ApiError(404, 'Không tìm thấy chứng từ');
    return;
  }

  // expense_photo — finance only; non-finance never reaches here.
  throw new ApiError(404, 'Không tìm thấy chứng từ');
}

function toResponse(row: typeof s.photoGeotags.$inferSelect): PhotoGeotag {
  return {
    id: row.id,
    entityType: row.entityType as GeotagEntityType,
    entityId: row.entityId,
    lat: row.lat,
    lng: row.lng,
    accuracy: row.accuracy,
    altitude: row.altitude,
    gpsAt: row.gpsAt ? row.gpsAt.toISOString() : null,
    source: row.source as PhotoGeotag['source'],
    sampleCount: row.sampleCount,
    bestAccuracy: row.bestAccuracy,
    elapsedMs: row.elapsedMs,
    recordedBy: row.recordedBy,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Upsert one geotag per (entityType, entityId). Returns the stored row. */
export async function submitGeotag(
  input: GeotagInput,
  user: AuthUserLike,
  dbOrTx: typeof db | Tx = db,
): Promise<PhotoGeotag> {
  const execute = async (tx: Tx) => {
    validateGpsFreshness(input.gpsAt);
    await authorizeGeotag(input.entityType, input.entityId, user, tx);
    await lockApplicationOwnedUniqueness(tx, 'photo-geotag', [input.entityType, input.entityId]);

    const gpsAt = input.gpsAt ? new Date(input.gpsAt) : null;
    const values = {
      entityType: input.entityType,
      entityId: input.entityId,
      lat: input.lat,
      lng: input.lng,
      accuracy: input.accuracy ?? null,
      altitude: input.altitude ?? null,
      gpsAt,
      source: input.source,
      sampleCount: input.sampleCount ?? null,
      bestAccuracy: input.bestAccuracy ?? null,
      elapsedMs: input.elapsedMs ?? null,
      recordedBy: user.userId,
    };

    const [existing] = await tx.select({ id: s.photoGeotags.id })
      .from(s.photoGeotags)
      .where(and(
        eq(s.photoGeotags.entityType, input.entityType),
        eq(s.photoGeotags.entityId, input.entityId),
      ))
      .limit(1);

    const [row] = existing
      ? await tx.update(s.photoGeotags)
        .set({
          lat: values.lat,
          lng: values.lng,
          accuracy: values.accuracy,
          altitude: values.altitude,
          gpsAt: values.gpsAt,
          source: values.source,
          sampleCount: values.sampleCount,
          bestAccuracy: values.bestAccuracy,
          elapsedMs: values.elapsedMs,
          recordedBy: values.recordedBy,
          createdAt: new Date(),
        })
        .where(eq(s.photoGeotags.id, existing.id))
        .returning()
      : await tx.insert(s.photoGeotags)
        .values(values)
        .returning();
    return toResponse(row);
  };

  return dbOrTx === db ? db.transaction(execute) : execute(dbOrTx as Tx);
}

/** Read a geotag, enforcing the same ownership gate as submit. */
export async function getGeotag(
  entityType: GeotagEntityType,
  entityId: number,
  user: AuthUserLike,
): Promise<PhotoGeotag> {
  await authorizeGeotag(entityType, entityId, user);
  const [row] = await db.select().from(s.photoGeotags)
    .where(and(eq(s.photoGeotags.entityType, entityType), eq(s.photoGeotags.entityId, entityId)))
    .limit(1);
  if (!row) throw new ApiError(404, 'Không tìm thấy vị trí GPS');
  return toResponse(row);
}
