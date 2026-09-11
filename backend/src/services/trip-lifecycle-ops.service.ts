// Small trip lifecycle operations: status reads, POD recovery marks,
// departure-date changes, reassignment, and soft delete. Extracted from
// trip-mutations.service.ts verbatim (pure code movement).
import { db } from '../db';
import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { TripStatus, Role, DriverProgressEventType } from '@tingting/shared';
import { ApiError } from '../errors';
import { assertTripShipmentAccountingUnlocked } from './shipment-accounting-lock.service';
import { removeTripWorkDays, syncTripWorkDays } from './attendance.service';
import {
  getTripCompositeInTx, splitTripPatch, tripCompositeSelect, upsertTripCarrierInfo,
} from './trip-composite.service';
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
    // Trips-split: composed row (ops + financial + carrier sidecars); the row
    // lock stays on trips only (`of`), matching the pre-split lock footprint.
    const [trip] = await tx.select(tripCompositeSelect())
      .from(s.trips)
      .leftJoin(s.tripFinancialState, eq(s.tripFinancialState.tripId, s.trips.id))
      .leftJoin(s.tripCarrierInfo, eq(s.tripCarrierInfo.tripId, s.trips.id))
      .where(eq(s.trips.id, tripId))
      .limit(1)
      .for('update', { of: [s.trips] });
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

/** Whether the assigned driver acknowledged the order on the driver app.
 * ORDER_RECEIVED is the explicit "nhận việc" action and the first milestone —
 * nothing later can be recorded without it — so its presence is the
 * acceptance signal. */
export async function tripHasDriverAcknowledgement(tx: Tx, tripId: number): Promise<boolean> {
  const [row] = await tx.select({ id: s.driverProgressEvents.id })
    .from(s.driverProgressEvents)
    .where(and(
      eq(s.driverProgressEvents.tripId, tripId),
      eq(s.driverProgressEvents.eventType, DriverProgressEventType.ORDER_RECEIVED),
    ))
    .limit(1);
  return row != null;
}

export async function reassignTrip(
  tripId: number,
  data: { carrierType?: 'OWN' | 'EXTERNAL'; truckId?: number | null; driverId?: number | null; externalCarrierId?: number | null; externalPlateNumber?: string | null; externalDriverName?: string | null; externalDriverPhone?: string | null; expectedVersion?: number; },
  transaction?: Tx,
) {
  const execute = async (tx: Tx) => {
    await assertTripShipmentAccountingUnlocked(tx, tripId);
    // Trips-split: composed row (ops + financial + carrier sidecars); the row
    // lock stays on trips only (`of`), matching the pre-split lock footprint.
    const [trip] = await tx.select(tripCompositeSelect())
      .from(s.trips)
      .leftJoin(s.tripFinancialState, eq(s.tripFinancialState.tripId, s.trips.id))
      .leftJoin(s.tripCarrierInfo, eq(s.tripCarrierInfo.tripId, s.trips.id))
      .where(eq(s.trips.id, tripId))
      .limit(1)
      .for('update', { of: [s.trips] });
    if (!trip) throw new ApiError(404, 'Không tìm thấy chuyến đi');
    if (data.expectedVersion !== undefined && trip.version !== data.expectedVersion) {
      throw new ApiError(409, 'Dữ liệu đã bị thay đổi bởi người khác. Vui lòng tải lại trang.');
    }
    // Strict reassignment guard (regression 2026-09-11 / DOC 1 BUG 1):
    // only `CREATED` (pre-departure, pre-driver-acknowledgement) trips
    // are reassignable. The earlier relaxation that allowed reassigning
    // an `IN_TRANSIT` trip whenever the driver had not yet acknowledged
    // (commit 60bef131) was rolled back per user feedback — operators
    // were re-assigning trucks after ops stamped "xuất phát" but before
    // the driver saw the order, leaving the driver no signal. The
    // driver-app "Phân xe lại" exception in TripReassignDialog still
    // routes the pre-departure correction; everything past CREATED is
    // owned by the driver app's acknowledgement flow. COMPLETED and
    // CANCELED stay terminal.
    if (trip.status !== TripStatus.CREATED) {
      throw new ApiError(409, 'Chỉ có thể đổi lái xe/xe cho chuyến chưa xuất phát');
    }

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

    const { ops: reassignOps, carrier: reassignCarrier } = splitTripPatch({
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
    });
    // Trips-split: guarded ops update + carrier sidecar upsert; the composed
    // re-read keeps the route's JSON response carrying the fresh carrier block.
    const [updatedOpsRow] = await tx.update(s.trips)
      .set(reassignOps as typeof s.trips.$inferInsert)
      .where(eq(s.trips.id, tripId)).returning({ id: s.trips.id });
    if (!updatedOpsRow) {
      throw new ApiError(409, 'Dữ liệu đã bị thay đổi bởi người khác. Vui lòng tải lại trang.');
    }
    await upsertTripCarrierInfo(tx, tripId, reassignCarrier);
    const updated = await getTripCompositeInTx(tx, tripId);
    if (!updated) throw new Error(`trip ${tripId} composed row missing after reassign`);

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

/**
 * Guard reads for the reassignment route: the trip snapshot the governed
 * write validates against, plus the fulfillment's optimistic-lock version.
 * Route leaves must not touch the db client directly (arch-layering).
 */
export async function loadReassignmentGuardContext(tripId: number) {
  // Trips-split: externalCarrierVehicleId lives in trip_carrier_info — read
  // through the composed view.
  const [trip] = await db.select({
    id: s.tripsComposite.id,
    version: s.tripsComposite.version,
    status: s.tripsComposite.status,
    driverId: s.tripsComposite.driverId,
    shipmentId: s.tripsComposite.shipmentId,
    fulfillmentId: s.tripsComposite.fulfillmentId,
    plannedStartAt: s.tripsComposite.plannedStartAt,
    plannedEndAt: s.tripsComposite.plannedEndAt,
    externalCarrierVehicleId: s.tripsComposite.externalCarrierVehicleId,
  }).from(s.tripsComposite).where(and(eq(s.tripsComposite.id, tripId), isNull(s.tripsComposite.deletedAt))).limit(1);
  return trip ?? null;
}

/**
 * Fallback-reassignment attendance re-key (TODO/20260911_2 BUG1 follow-up):
 * when an unlinked trip is reassigned after an ops "Phát lệnh" already
 * stamped the OLD driver's attendance work-days, move them to the new
 * driver. Best-effort — an attendance failure must never block the
 * reassignment (same contract as syncAttendanceAfterStatusChange).
 */
export async function resyncAttendanceAfterReassignment(
  before: { id: number; status: string | null; driverId: number | null },
  after: { id: number; driverId: number | null; departureDate: string | null },
  actorId: number | null,
): Promise<void> {
  if (before.status == null || before.status === TripStatus.CREATED || (before.driverId ?? null) === (after.driverId ?? null)) return;
  try {
    if (before.driverId != null) {
      await removeTripWorkDays(before.driverId, after.id);
    }
    if (after.driverId != null && after.departureDate != null) {
      await syncTripWorkDays(after.driverId, after.id, after.departureDate, null, actorId);
    }
  } catch (error) {
    console.warn('[attendance] fallback reassignment resync failed for trip', after.id, error);
  }
}

export async function loadFulfillmentVersion(fulfillmentId: number): Promise<number | null> {
  const [fulfillment] = await db.select({ version: s.shipmentFulfillments.version })
    .from(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, fulfillmentId)).limit(1);
  return fulfillment?.version ?? null;
}
