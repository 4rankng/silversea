// Small trip lifecycle operations: status reads, POD recovery marks,
// departure-date changes, reassignment, and soft delete. Extracted from
// trip-mutations.service.ts verbatim (pure code movement).
import { db } from '../db';
import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { TripStatus, Role } from '@tingting/shared';
import { ApiError } from '../errors';
import { assertTripShipmentAccountingUnlocked } from './shipment-accounting-lock.service';
import { resolveTrailer } from './trip-shared';
import type { Tx } from './trip-shared';

/** Status read for the cancel-route guard; throws 404 when the trip is missing. */
export async function getTripStatusOr404(tripId: number): Promise<string | null> {
  const [current] = await db.select({ status: s.trips.status })
    .from(s.trips).where(eq(s.trips.id, tripId)).limit(1);
  if (!current) throw new ApiError(404, 'Không tìm thấy chuyến đi');
  return current.status;
}

/** Marks a trip's paper POD as recovered (optimistic-locked write). */
export async function markTripPodRecovered(
  tripId: number,
  recoveredBy: number,
  expectedVersion?: number,
) {
  const [updated] = await db.update(s.trips).set({
    podRecoveredAt: new Date(),
    podRecoveredBy: recoveredBy,
    version: sql`${s.trips.version} + 1`,
    updatedAt: new Date(),
  }).where(and(
    eq(s.trips.id, tripId),
    ...(expectedVersion !== undefined ? [eq(s.trips.version, expectedVersion)] : []),
  )).returning();
  if (!updated) throw new ApiError(409, 'Chuyến đi đã bị thay đổi. Vui lòng tải lại.');
  return updated;
}

export async function updateDepartureDate(
  tripId: number,
  newDepartureDate: string,
  userId: number,
  userRole: string,
  expectedVersion?: number,
  transaction?: Tx,
) {
  if (userRole !== Role.ADMIN && userRole !== Role.MANAGER) {
    throw new ApiError(403, 'Chỉ Quản lý hoặc Quản trị viên mới có quyền thay đổi ngày khởi hành');
  }

  const execute = async (tx: Tx) => {
    await assertTripShipmentAccountingUnlocked(tx, tripId);
    const [trip] = await tx.select().from(s.trips).where(eq(s.trips.id, tripId)).limit(1).for('update');
    if (!trip) throw new ApiError(404, 'Không tìm thấy chuyến đi');
    if (expectedVersion !== undefined && trip.version !== expectedVersion) {
      throw new ApiError(409, 'Dữ liệu đã bị thay đổi bởi người khác. Vui lòng tải lại trang.');
    }
    if (trip.status === TripStatus.CANCELED) {
      throw new ApiError(400, 'Không thể thay đổi ngày khởi hành của chuyến đã hủy');
    }
    if (trip.status === TripStatus.COMPLETED) {
      throw new ApiError(409, 'Không thể thay đổi ngày khởi hành của chuyến đã chốt');
    }
    if (trip.departureDate === newDepartureDate) return trip; // Idempotent

    const [updated] = await tx.update(s.trips).set({
      departureDate: newDepartureDate,
      version: sql`${s.trips.version} + 1`,
      updatedAt: new Date(),
    }).where(eq(s.trips.id, tripId)).returning();

    return updated;
  };
  return runInTx(transaction, execute);
}

// ─── reassignTrip ───────────────────────────────────────────────────────────

export async function reassignTrip(
  tripId: number,
  data: { carrierType?: 'OWN' | 'EXTERNAL'; truckId?: number | null; driverId?: number | null; externalCarrierId?: number | null; externalPlateNumber?: string | null; externalDriverName?: string | null; externalDriverPhone?: string | null; expectedVersion?: number; },
  transaction?: Tx,
) {
  const execute = async (tx: Tx) => {
    await assertTripShipmentAccountingUnlocked(tx, tripId);
    const [trip] = await tx.select().from(s.trips).where(eq(s.trips.id, tripId)).limit(1).for('update');
    if (!trip) throw new ApiError(404, 'Không tìm thấy chuyến đi');
    if (data.expectedVersion !== undefined && trip.version !== data.expectedVersion) {
      throw new ApiError(409, 'Dữ liệu đã bị thay đổi bởi người khác. Vui lòng tải lại trang.');
    }
    if (trip.status !== TripStatus.CREATED) throw new ApiError(409, 'Chỉ có thể đổi lái xe/xe cho chuyến chưa xuất phát');

    const carrierType = data.carrierType || 'OWN';
    let trailerId = trip.trailerId;
    let trailerType = trip.trailerType;

    if (carrierType === 'OWN') {
      const [newTruck] = await tx.select({ id: s.trucks.id, trailerType: s.trucks.trailerType, currentTrailerId: s.trucks.currentTrailerId }).from(s.trucks)
        .where(and(eq(s.trucks.id, data.truckId!), isNull(s.trucks.deletedAt))).limit(1);
      if (!newTruck) throw new ApiError(400, 'Xe đầu kéo không tồn tại hoặc đã bị xóa');
      const [driver] = await tx.select({ id: s.drivers.id }).from(s.drivers)
        .where(and(eq(s.drivers.id, data.driverId!), isNull(s.drivers.deletedAt))).limit(1);
      if (!driver) throw new ApiError(400, 'Lái xe không tồn tại hoặc đã bị xóa');

      const resolved = await resolveTrailer(tx, newTruck.currentTrailerId);
      trailerId = resolved.trailerId;
      trailerType = (resolved.trailerType || newTruck.trailerType || trip.trailerType || '40FT') as '20FT' | '40FT';
    } else {
      trailerId = null;
      trailerType = null;
    }

    const [updated] = await tx.update(s.trips).set({
      carrierType,
      truckId: carrierType === 'OWN' ? data.truckId! : null,
      driverId: carrierType === 'OWN' ? data.driverId! : null,
      trailerId,
      trailerType,
      externalEntityId: carrierType === 'EXTERNAL' && data.externalCarrierId ? data.externalCarrierId : null,
      externalEntityType: carrierType === 'EXTERNAL' && data.externalCarrierId ? 'CUSTOMER' : null,
      externalPlateNumber: carrierType === 'EXTERNAL' && data.externalPlateNumber ? data.externalPlateNumber : null,
      externalDriverName: carrierType === 'EXTERNAL' && data.externalDriverName ? data.externalDriverName : null,
      externalDriverPhone: carrierType === 'EXTERNAL' && data.externalDriverPhone ? data.externalDriverPhone : null,
      version: sql`${s.trips.version} + 1`,
      updatedAt: new Date(),
    }).where(eq(s.trips.id, tripId)).returning();

    return updated;
  };
  return runInTx(transaction, execute);
}


/**
 * Soft-delete a trip. Only trips in CREATED status can be deleted; any other
 * status (IN_TRANSIT, COMPLETED, CANCELED) returns 409. Per flow 01 §2.6.
 */
export async function deleteTrip(
  tripId: number,
  expectedVersion?: number,
  transaction?: Tx,
): Promise<void> {
  const execute = async (tx: Tx) => {
    await assertTripShipmentAccountingUnlocked(tx, tripId);
    const [trip] = await tx.select({ id: s.trips.id, status: s.trips.status, version: s.trips.version, deletedAt: s.trips.deletedAt })
      .from(s.trips)
      .where(eq(s.trips.id, tripId)).limit(1).for('update');
    if (!trip) throw new ApiError(404, "Không tìm thấy chuyến đi");
    if (trip.deletedAt) throw new ApiError(404, "Không tìm thấy chuyến đi");
    if (expectedVersion !== undefined && trip.version !== expectedVersion) {
      throw new ApiError(409, 'Dữ liệu đã bị thay đổi bởi người khác. Vui lòng tải lại trang.');
    }
    if (trip.status !== TripStatus.CREATED) {
      throw new ApiError(409, `Chỉ xóa được chuyến ở trạng thái CREATED (hiện tại: ${trip.status})`);
    }
    await tx.update(s.trips).set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(s.trips.id, tripId));
  };
  return runInTx(transaction, execute);
}
