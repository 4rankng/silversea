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
import { getAuditRequestContext } from './audit.service';
import { assertTripRigAvailable } from './dispatch-plan-conflict-scan.service';
import { propagateKepPairRigToPartner } from './trip-pair-rig-sync.service';
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

/** Card 091026190520 (FB-081, option b): does this reassignment change WHO
 * drives the trip? After the driver acknowledged (ORDER_RECEIVED) only a
 * vehicle-only correction is allowed — the driver keeps the job they
 * accepted. A carrier-type switch always counts as a driver change (OWN→EXTERNAL
 * drops the internal driver; EXTERNAL→OWN assigns one); for external trips the
 * driver identity is the name/phone pair. */
export function driverChangesAfterAcknowledgement(
  trip: { carrierType: string | null; driverId: number | null; externalDriverName: string | null; externalDriverPhone: string | null },
  data: { carrierType?: 'OWN' | 'EXTERNAL'; driverId?: number | null; externalDriverName?: string | null; externalDriverPhone?: string | null },
): boolean {
  const next = data.carrierType || 'OWN';
  if ((trip.carrierType ?? 'OWN') !== next) return true;
  if (next === 'OWN') {
    return data.driverId != null && Number(data.driverId) !== trip.driverId;
  }
  const nextName = (data.externalDriverName ?? trip.externalDriverName ?? '').trim();
  const nextPhone = (data.externalDriverPhone ?? trip.externalDriverPhone ?? '').trim();
  return nextName !== (trip.externalDriverName ?? '').trim() || nextPhone !== (trip.externalDriverPhone ?? '').trim();
}

export async function reassignTrip(
  tripId: number,
  data: { carrierType?: 'OWN' | 'EXTERNAL'; truckId?: number | null; driverId?: number | null; externalCarrierId?: number | null; externalPlateNumber?: string | null; /** Round 19: the route-resolved carrier-fleet vehicle id; null clears the linkage, undefined leaves the stored one untouched. */ externalCarrierVehicleId?: number | null; externalDriverName?: string | null; externalDriverPhone?: string | null; expectedVersion?: number; /** Round-18 review sweep: the confirmed retry of the trip-side overlap warn (the FE reassign dialog's existing flag). */ confirmOverlap?: boolean; },
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
    if (trip.status !== TripStatus.CREATED) {
      // Reassignment relaxation (TODO/20260911_2 BUG1): an ops "xuất phát"
      // can flip the trip to IN_TRANSIT before any driver acknowledgement, so
      // IN_TRANSIT alone must not block the correction — only the driver's
      // ORDER_RECEIVED milestone does. COMPLETED/CANCELED stay terminal.
      // Card 091026190520 (FB-081, option b): after acknowledgement a
      // VEHICLE-ONLY correction is still allowed (truck/trailer for OWN,
      // carrier/plate for EXTERNAL) — the driver keeps the job they accepted.
      const acknowledged = trip.status === TripStatus.IN_TRANSIT
        && (await tripHasDriverAcknowledgement(tx, tripId));
      const reassignable = trip.status === TripStatus.IN_TRANSIT && !acknowledged;
      if (!reassignable) {
        if (!acknowledged) {
          throw new ApiError(409, 'Chỉ có thể đổi lái xe/xe cho chuyến chưa xuất phát');
        }
        if (driverChangesAfterAcknowledgement(trip, data)) {
          throw new ApiError(409, 'Lái xe đã nhận việc — chỉ được đổi xe, giữ lái xe.');
        }
      }
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

      // Round-18 review sweep (§2 sibling consumers): the fallback
      // reassignment path — a trip without a resolvable fulfillment, or one
      // whose staged times never landed — wrote truck+driver with NO overlap
      // guard, silently double-booking a rig or a driver while the governed
      // reassign flow warned. The trip-side guard claims the pair here too,
      // at the family's warn tier; the route forwards the FE dialog's
      // existing confirm flag as the retry.
      const nextTruckId = data.truckId ?? trip.truckId;
      const nextDriverId = data.driverId ?? trip.driverId;
      const claimMoved = nextTruckId !== trip.truckId || nextDriverId !== trip.driverId;
      if (nextTruckId != null && claimMoved) {
        await assertTripRigAvailable(tx, {
          tripId,
          truckId: nextTruckId,
          driverId: nextDriverId,
          departureDate: trip.departureDate,
          plannedStartAt: trip.plannedStartAt,
          plannedEndAt: trip.plannedEndAt,
          fulfillmentId: trip.fulfillmentId,
          shipmentId: trip.shipmentId,
          confirmOverlap: data.confirmOverlap === true,
        });
      }

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
      // Round 19 (M1 sweep): the reassignment route resolves the carrier's
      // vehicle id (picker pick → id; carrier/plate change → null so the
      // previous carrier's linkage does not survive under a new plate) and
      // hands it here. Callers that omit the key keep the pre-existing
      // behavior — the sidecar keeps its stored linkage untouched.
      ...(data.externalCarrierVehicleId !== undefined ? {
        externalCarrierVehicleId: carrierType === 'EXTERNAL' && data.externalCarrierVehicleId != null
          ? Number(data.externalCarrierVehicleId)
          : null,
      } : {}),
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
    // FB-081 v2 (card 181026003045, option 2-lite): a Kẹp pair moves as ONE
    // rig — this fallback reassign must propagate the new truck/trailer/driver
    // onto the partner leg of the trip's ACTIVE Kẹp pair inside this same
    // transaction (throws roll the whole reassign back), killing both halves
    // of the reported defect: the hard 409 against the partner's overlap and
    // the silent pair-split when only the truck changed.
    if (trip.activeTripPairId != null) {
      const auditUser = getAuditRequestContext()?.req.user;
      await propagateKepPairRigToPartner(tx, {
        tripId,
        carrierType,
        truckId: carrierType === 'OWN' ? (data.truckId ?? trip.truckId) : null,
        trailerId,
        driverId: carrierType === 'OWN' ? (data.driverId ?? trip.driverId) : null,
        actor: auditUser != null ? {
          userId: auditUser.userId,
          role: auditUser.role,
          name: auditUser.fullName ?? auditUser.username,
        } : null,
      });
    }
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
/**
 * Round 19 (Đổi nhà xe + biển sau phát lệnh): which carrier-fleet vehicle id
 * the governed reassignment should carry. The old blanket "preserve the
 * issued vehicle" made every carrier/plate change impossible — the preserved
 * vehicle belongs to the OLD carrier (409 "Xe không thuộc nhà xe đã gán…")
 * and its stored plate silently beat the typed one. Contract:
 *  - an explicit picker-provided id always wins (validated against the
 *    payload's carrier by the write command);
 *  - a carrier change or a different typed plate DROPS the preserved id so
 *    the typed plate text rides;
 *  - an unchanged carrier+plate payload keeps the issued vehicle (idempotent
 *    re-save, and partner-less payloads keep a real active vehicle for the
 *    governed validation).
 */
export function resolveReassignExternalVehicleId(args: {
  trip: { externalCarrierId: number | null; externalPlateNumber: string | null; externalCarrierVehicleId: number | null };
  payload: { externalCarrierId?: number | null; externalPlateNumber?: string | null; externalCarrierVehicleId?: number | null };
}): number | null {
  const providedVehicleId = args.payload.externalCarrierVehicleId != null
    ? Number(args.payload.externalCarrierVehicleId)
    : null;
  if (providedVehicleId != null) return providedVehicleId;
  const nextCarrierId = args.payload.externalCarrierId != null ? Number(args.payload.externalCarrierId) : null;
  const nextPlate = typeof args.payload.externalPlateNumber === 'string' ? args.payload.externalPlateNumber.trim() : null;
  // A carrier switch counts even when the trip's carrier id is missing but
  // its vehicle linkage survives (data-anomaly guard, round-19 review m2):
  // an orphaned vehicle must not ride along onto the newly named carrier.
  const carrierChanged = nextCarrierId != null
    && (args.trip.externalCarrierId != null || args.trip.externalCarrierVehicleId != null)
    && nextCarrierId !== args.trip.externalCarrierId;
  const plateChanged = nextPlate != null
    && nextPlate !== ''
    && args.trip.externalPlateNumber != null
    && nextPlate.toUpperCase() !== args.trip.externalPlateNumber.trim().toUpperCase();
  return carrierChanged || plateChanged ? null : args.trip.externalCarrierVehicleId ?? null;
}

export async function loadReassignmentGuardContext(tripId: number) {
  // Trips-split: external carrier/vehicle columns live in trip_carrier_info —
  // read through the composed view. externalCarrierId/externalPlateNumber
  // ride along for the route's "did the payload change the carrier or the
  // plate?" vehicle-preservation test (round 19, Đổi nhà xe + biển).
  const [trip] = await db.select({
    id: s.tripsComposite.id,
    version: s.tripsComposite.version,
    status: s.tripsComposite.status,
    driverId: s.tripsComposite.driverId,
    shipmentId: s.tripsComposite.shipmentId,
    fulfillmentId: s.tripsComposite.fulfillmentId,
    plannedStartAt: s.tripsComposite.plannedStartAt,
    plannedEndAt: s.tripsComposite.plannedEndAt,
    // The carrier partner rides as external_entity_id on the composed view
    // (CUSTOMER-typed); it is the trips.externalCarrierId of the API shape.
    externalCarrierId: s.tripsComposite.externalEntityId,
    externalPlateNumber: s.tripsComposite.externalPlateNumber,
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
