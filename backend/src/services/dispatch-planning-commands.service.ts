/**
 * dispatch-planning commands — accept-handoff + issue/reassign dispatch order writes.
 * Extracted from dispatch-planning.service.ts (structure-only split, no behavior change).
 * Layering: utils <- queries <- detail; utils <- commands <- detail (keep acyclic).
 */
import { LiveTripRow } from './dispatch-planning-utils.service';
import { getTripCompositeInTx, splitTripPatch, upsertTripCarrierInfo } from './trip-composite.service';
import { DispatchActor, Tx, assertDispatchActor, authoritativeCargoWeightKg, buildNotificationPayload, dispatchAssignmentChanged, hasExplicitNotificationTarget, inferTrailerTypeFromContainerCode, inferredVehicleCapacityKg, parseIsoWithZone, routeServiceDurationMinutes, toIsoOrNull, trimBounded } from './dispatch-planning-utils.service';
import { db } from '../db';
import { ApiError } from '../errors';
import { resolveHandoff } from './dispatch-handoff.service';
import { runIdempotent, IDEMPOTENCY_ENDPOINTS } from './idempotency.service';
import { getActiveAssignment } from './truck-driver-assignment.service';
import { persistNotificationInTx, sendNotificationPush } from './notification.service';
import { assertActorCanAccessShipment } from './shipment-coordination.service';
import { ensureShipmentFulfillmentsInTx } from './shipment-fulfillment.service';
import { transitionShipmentStatus } from './shipment.service';
import { createTrip } from './trip-mutations.service';
import { tripHasDriverAcknowledgement } from './trip-lifecycle-ops.service';
import { removeTripWorkDays, syncTripWorkDays } from './attendance.service';
import { assertShipmentAccountingUnlocked } from './shipment-accounting-lock.service';
import { lockShipmentFreightRate } from './freight-rate-snapshot-lifecycle.service';
import { resolveDispatchFactorySnapshot } from './trip-factory-site.service';
import { completeExternalCarrierTrip } from './trip-external-close.service';


import { and, count, eq, gt, inArray, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { canonicalShipmentStatus, localDateInBusinessZone, NotificationType, Role, TripStatus, type FuelMode } from '@tingting/shared';

import * as s from '../db/schema';
import { CARGO_MODE } from '../db/schema';




/** Trips-split: a composed row missing its carrier sidecar coalesces
 * carrierType to the legacy trips default so it stays assignable to
 * LiveTripRow. */
function toLiveTripRow(row: NonNullable<Awaited<ReturnType<typeof getTripCompositeInTx>>>): LiveTripRow {
  return { ...row, carrierType: row.carrierType ?? 'OWN' };
}

export interface AcceptDispatchHandoffInput {
  shipmentId: number;
  handoffId: number;
  expectedVersion: number;
  actor: DispatchActor;
}


export interface IssueFulfillmentDispatchOrderInput {
  shipmentId: number;
  fulfillmentId: number;
  expectedVersion: number;
  /** Required when correcting a published trip to prevent a silent overwrite. */
  expectedTripVersion?: number;
  /**
   * Reassignment-only relaxation (TODO/20260911_2 BUG1): allow correcting a
   * trip whose status already left CREATED through the ops departure write
   * while the assigned driver never acknowledged the order. Set by
   * reassignIssuedDispatchWriteCommand; the issue path leaves it unset so
   * issuance keeps blocking every non-CREATED live trip.
   */
  allowUnacknowledgedDeparture?: boolean;
  plannedStartAt: string;
  plannedEndAt: string;
  endTimeConfirmed: boolean;
  carrierType: 'OWN' | 'EXTERNAL';
  cargoTypeId?: number | null;
  truckId?: number | null;
  driverId?: number | null;
  trailerId?: number | null;
  containerTypeId?: number | null;
  pricingRateKey?: string | null;
  externalCarrierId?: number | null;
  externalCarrierVehicleId?: number | null;
  externalPlateNumber?: string | null;
  externalDriverName?: string | null;
  externalDriverPhone?: string | null;
  fuelMode?: FuelMode;
  idempotencyKey: string;
  actor: DispatchActor;
}




export interface IssueOrderMutationResult {
  fulfillment: typeof s.shipmentFulfillments.$inferSelect;
  trip: LiveTripRow;
  notificationPersisted: boolean;
  /**
   * Set when a reassignment corrected a departed-but-unacknowledged trip AND
   * the driver changed: the ops "Phát lệnh" had already stamped attendance
   * work-days for the OLD driver, so the command's caller must re-key them
   * to the new driver after commit (best-effort, never blocks the write).
   */
  attendanceResync?: {
    tripId: number;
    previousDriverId: number | null;
    driverId: number | null;
    departureDate: string | null;
  };
}


export async function acceptDispatchHandoff(input: AcceptDispatchHandoffInput) {
  assertDispatchActor(input.actor);
  const outcome = await db.transaction(async (tx) => {
    await assertActorCanAccessShipment(tx, input.shipmentId, input.actor, { write: true });
    await assertShipmentAccountingUnlocked(tx, input.shipmentId);
    const handoff = await resolveHandoff(
      input.handoffId,
      'ACCEPTED',
      input.actor.userId,
      input.expectedVersion,
      { expectedShipmentId: input.shipmentId, transaction: tx },
    );
    const fulfillments = await ensureShipmentFulfillmentsInTx(tx, {
      shipmentId: input.shipmentId,
      actorId: input.actor.userId,
    });
    if (fulfillments.some((row) => row.cargoMode === CARGO_MODE.FCL && row.plannedCarrierType == null)) {
      throw new ApiError(409, 'CUS chưa gán đủ nhà xe cho các container.');
    }
    return { handoff, fulfillments };
  });
  return {
    handoff: outcome.handoff,
    fulfillments: outcome.fulfillments,
  };
}


export async function loadLiveTripForFulfillment(tx: Tx, fulfillmentId: number): Promise<LiveTripRow | null> {
  // Trips-split: the carrier block lives in trip_carrier_info; the row lock
  // stays on trips only (`of`), matching the pre-split lock footprint.
  const [row] = await tx.select({
    id: s.trips.id,
    version: s.trips.version,
    tripCode: s.trips.tripCode,
    status: s.trips.status,
    shipmentId: s.trips.shipmentId,
    fulfillmentId: s.trips.fulfillmentId,
    carrierType: s.tripCarrierInfo.carrierType,
    truckId: s.trips.truckId,
    driverId: s.trips.driverId,
    trailerId: s.trips.trailerId,
    departureDate: s.trips.departureDate,
    plannedStartAt: s.trips.plannedStartAt,
    plannedEndAt: s.trips.plannedEndAt,
    externalEntityId: s.tripCarrierInfo.externalEntityId,
    externalEntityType: s.tripCarrierInfo.externalEntityType,
    externalPlateNumber: s.tripCarrierInfo.externalPlateNumber,
    externalDriverName: s.tripCarrierInfo.externalDriverName,
    externalDriverPhone: s.tripCarrierInfo.externalDriverPhone,
    createdBy: s.trips.createdBy,
    createdAt: s.trips.createdAt,
    updatedAt: s.trips.updatedAt,
  }).from(s.trips)
    .leftJoin(s.tripCarrierInfo, eq(s.tripCarrierInfo.tripId, s.trips.id))
    .where(and(
      eq(s.trips.fulfillmentId, fulfillmentId),
      ne(s.trips.status, TripStatus.CANCELED),
      isNull(s.trips.deletedAt),
    ))
    .limit(1)
    .for('update', { of: [s.trips] });
  return row ? { ...row, carrierType: row.carrierType ?? 'OWN' } : null;
}


export async function replaceTripContainersForFulfillment(
  tx: Tx,
  tripId: number,
  shipment: typeof s.shipments.$inferSelect,
  fulfillment: typeof s.shipmentFulfillments.$inferSelect,
  actorId: number,
) {
  await tx.delete(s.tripContainerSeals)
    .where(inArray(
      s.tripContainerSeals.tripContainerId,
      tx.select({ id: s.tripContainers.id }).from(s.tripContainers).where(eq(s.tripContainers.tripId, tripId)),
    ));
  await tx.delete(s.tripContainers).where(eq(s.tripContainers.tripId, tripId));

  if (fulfillment.shipmentContainerId == null) {
    await tx.insert(s.tripContainers).values({
      tripId,
      sourceShipmentId: shipment.id,
      sourceShipmentVersion: shipment.version,
      containerTypeId: null,
      containerNumber: null,
      sealNumber: null,
      cargoWeightKg: shipment.cargoWeightKg,
      notes: `__fulfillment_lcl:${fulfillment.id}`,
      createdBy: actorId,
    });
    return;
  }

  const [container] = await tx.select().from(s.shipmentContainers)
    .where(and(
      eq(s.shipmentContainers.id, fulfillment.shipmentContainerId),
      eq(s.shipmentContainers.shipmentId, shipment.id),
    ))
    .limit(1);
  if (!container) {
    throw new ApiError(409, 'Container nguồn của tác vụ không còn hợp lệ.');
  }
  await tx.insert(s.tripContainers).values({
    tripId,
    sourceShipmentId: shipment.id,
    sourceShipmentContainerId: container.id,
    sourceShipmentVersion: shipment.version,
      containerTypeId: container.containerTypeId,
      containerNumber: container.containerNumber,
      sealNumber: container.sealNumber,
      cargoWeightKg: container.cargoWeightKg,
      // No debug marker here: this note is user-visible in the forwarder UI.
      // The LCL synthetic scope uses a `__fulfillment_lcl:` prefix that is
      // functionally read by shipment completion logic; FCL containers need no
      // such linkage marker, so we leave notes empty for operator use.
      notes: null,
      createdBy: actorId,
    });
}


export async function assertResourceAvailability(
  tx: Tx,
  args: {
    tripId: number | null;
    truckId: number | null;
    trailerId: number | null;
    driverId: number | null;
    plannedStartAt: Date;
    plannedEndAt: Date;
    /**
     * Kẹp context: when the trip being issued carries a 20' container, a
     * conflicting row that ALSO carries a 20' container on the SAME departure
     * day is the pairing partner (2×20' on one mooc), not a double booking.
     * Without this exemption the second leg of a kẹp plan can never be
     * issued — the pair (trip_pairs) is only created after both trips exist.
     * Mirrors the KEP eligibility rules in createTripPair (same departure
     * day + two 20' shells). Everything else (40' mixes, other days,
     * non-pairable shapes) keeps the strict conflict.
     */
    kepContext?: {
      issuingContainerIsTwentyFoot: boolean;
      /** trips.departure_date basis (UTC slice of plannedStartAt) — the same value createTrip stores. */
      departureDate: string;
    } | null;
  },
) {
  const predicates = [];
  if (args.truckId != null) predicates.push(eq(s.trips.truckId, args.truckId));
  if (args.trailerId != null) predicates.push(eq(s.trips.trailerId, args.trailerId));
  if (args.driverId != null) predicates.push(eq(s.trips.driverId, args.driverId));
  if (predicates.length === 0) return;

  const conflicts = await tx.select({
    id: s.trips.id,
    tripCode: s.trips.tripCode,
    truckId: s.trips.truckId,
    trailerId: s.trips.trailerId,
    driverId: s.trips.driverId,
    departureDate: s.trips.departureDate,
    hasTwentyFootContainer: sql<boolean>`exists (
      select 1 from trip_containers tc
      left join container_types ct on ct.id = tc.container_type_id
      where tc.trip_id = trips.id
        and ct.code like '20%'
    )`,
  }).from(s.trips)
    .where(and(
      or(...predicates)!,
      isNull(s.trips.deletedAt),
      inArray(s.trips.status, [TripStatus.CREATED, TripStatus.IN_TRANSIT]),
      args.tripId != null ? ne(s.trips.id, args.tripId) : undefined,
      isNotNull(s.trips.plannedStartAt),
      isNotNull(s.trips.plannedEndAt),
      lt(s.trips.plannedStartAt, args.plannedEndAt),
      gt(s.trips.plannedEndAt, args.plannedStartAt),
    ));
  const blocking = args.kepContext?.issuingContainerIsTwentyFoot
    ? conflicts.filter((row) =>
      row.departureDate !== args.kepContext!.departureDate
      || !row.hasTwentyFootContainer,
    )
    : conflicts;
  if (blocking.find((row) => args.truckId != null && row.truckId === args.truckId)) {
    throw new ApiError(409, 'Xe đầu kéo đã bị trùng lịch kế hoạch.');
  }
  if (blocking.find((row) => args.trailerId != null && row.trailerId === args.trailerId)) {
    throw new ApiError(409, 'Rơ-moóc đã bị trùng lịch kế hoạch.');
  }
  if (blocking.find((row) => args.driverId != null && row.driverId === args.driverId)) {
    throw new ApiError(409, 'Tài xế đã bị trùng lịch kế hoạch.');
  }
}


export async function issueOrderCreateOrUpdate(
  tx: Tx,
  input: IssueFulfillmentDispatchOrderInput,
): Promise<IssueOrderMutationResult> {
  await assertActorCanAccessShipment(tx, input.shipmentId, input.actor, { write: true });
  await assertShipmentAccountingUnlocked(tx, input.shipmentId);
  const [shipment] = await tx.select().from(s.shipments)
    .where(and(eq(s.shipments.id, input.shipmentId), isNull(s.shipments.deletedAt)))
    .limit(1)
    .for('update');
  if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng.');
  const shipmentStatus = canonicalShipmentStatus(shipment.status);
  // Per-container issuance: only terminal shipments block new orders. A
  // partially-completed lot (or a legacy row parked at the retired
  // PENDING_EXPENSE_APPROVAL stage) must keep its remaining planned
  // carriers issuable — otherwise the 2nd container of a 2-container lot
  // gets stranded after the 1st completes (2026-09-05 prod bug).
  if (shipmentStatus === 'COMPLETED' || shipmentStatus === 'CANCELED') {
    throw new ApiError(409, 'Lô hàng đã kết thúc, không thể phát lệnh.');
  }
  const [fulfillment] = await tx.select().from(s.shipmentFulfillments)
    .where(and(
      eq(s.shipmentFulfillments.id, input.fulfillmentId),
      eq(s.shipmentFulfillments.shipmentId, shipment.id),
    ))
    .limit(1)
    .for('update');
  if (!fulfillment) throw new ApiError(404, 'Không tìm thấy tác vụ điều xe.');
  if (fulfillment.canceledAt) throw new ApiError(409, 'Tác vụ đã bị hủy.');
  if (fulfillment.version !== input.expectedVersion) {
    throw new ApiError(409, 'Tác vụ điều xe đã thay đổi. Vui lòng tải lại.');
  }
  const [containerRoute] = fulfillment.shipmentContainerId == null
    ? []
    : await tx.select({
      routeId: s.shipmentContainers.routeId,
      containerTypeCode: s.containerTypes.code,
    })
      .from(s.shipmentContainers)
      .leftJoin(s.containerTypes, eq(s.containerTypes.id, s.shipmentContainers.containerTypeId))
      .where(eq(s.shipmentContainers.id, fulfillment.shipmentContainerId))
      .limit(1);
  const effectiveRouteId = fulfillment.cargoMode === CARGO_MODE.FCL
    ? containerRoute?.routeId ?? null
    : shipment.routeId;
  const [route] = effectiveRouteId == null
    ? []
    : await tx.select({ distanceKm: s.routes.distanceKm })
      .from(s.routes)
      .where(and(eq(s.routes.id, effectiveRouteId), isNull(s.routes.deletedAt)))
      .limit(1);
  if (effectiveRouteId == null || !route) {
    throw new ApiError(409, 'Container chưa có tuyến đường hợp lệ.');
  }
  // 2026-09-09 ruling "điều vận được phép đổi xe": the dispatcher may change
  // the carrier type/partner at issue and reissue (Phân xe lại) time, so the
  // issue payload — not the CUS-planned carrier — drives carrier selection.
  // The CUS plan remains the fallback for partner-less payloads.
  const plannedStartAt = parseIsoWithZone(input.plannedStartAt, 'Giờ chạy');
  const serviceDurationMinutes = routeServiceDurationMinutes(route?.distanceKm ?? null);
  const plannedEndAt = serviceDurationMinutes == null
    ? parseIsoWithZone(input.plannedEndAt, 'Giờ kết thúc')
    : new Date(plannedStartAt.getTime() + serviceDurationMinutes * 60_000);
  if (plannedEndAt.getTime() <= plannedStartAt.getTime()) {
    throw new ApiError(400, 'Giờ kết thúc phải sau giờ chạy.');
  }
  if (serviceDurationMinutes == null && !input.endTimeConfirmed) {
    throw new ApiError(409, 'Tuyến chưa có thời lượng chuẩn. Vui lòng xác nhận giờ kết thúc.');
  }

  const cargoTypeId = shipment.cargoTypeId ?? null;

  let truckId: number | null = null;
  let trailerId: number | null = null;
  let driverId: number | null = null;
  let externalCarrierId: number | null = null;
  let externalPlateNumber: string | null = null;
  let externalDriverName: string | null = null;
  let externalDriverPhone: string | null = null;
  let externalCarrierVehicleId: number | null = null;
  let containerTypeId: number | null = input.containerTypeId ?? null;
  let driverUserId: number | null = null;
  let cargoWeightKg: string | null = shipment.cargoWeightKg ?? null;
  let vehicleCapacityKg: string | null = null;

  if (input.carrierType === 'OWN') {
    if (input.truckId == null || input.driverId == null) {
      throw new ApiError(400, 'Điều xe nội bộ phải chọn xe và tài xế.');
    }
    const [truck] = await tx.select({
      id: s.trucks.id,
      currentTrailerId: s.trucks.currentTrailerId,
      status: s.trucks.status,
      trailerType: s.trucks.trailerType,
      deletedAt: s.trucks.deletedAt,
    }).from(s.trucks).where(eq(s.trucks.id, input.truckId)).limit(1);
    if (!truck || truck.deletedAt || truck.status !== 'ACTIVE') {
      throw new ApiError(409, 'Xe đầu kéo không còn hiệu lực.');
    }
    const [driver] = await tx.select({
      id: s.drivers.id,
      userId: s.drivers.userId,
      status: s.drivers.status,
      deletedAt: s.drivers.deletedAt,
    }).from(s.drivers)
      .where(eq(s.drivers.id, input.driverId))
      .limit(1)
      .for('update');
    const [driverUser] = driver?.userId == null
      ? []
      : await tx.select({
        status: s.users.status,
        role: s.users.role,
        deletedAt: s.users.deletedAt,
      }).from(s.users).where(eq(s.users.id, driver.userId)).limit(1);
    if (
      !driver
      || driver.deletedAt
      || driver.status !== 'ACTIVE'
      || driver.userId == null
      || !driverUser
      || driverUser.deletedAt
      || driverUser.status !== 'ACTIVE'
      || driverUser.role !== Role.DRIVER
    ) {
      throw new ApiError(409, 'Tài xế không còn hiệu lực để nhận lệnh.');
    }
    driverUserId = driver.userId;
    // Telemetry only — no enforcement. Records how often the explicitly
    // issued driverId differs from the truck's active assignment, gathering
    // 1-2 weeks of staging + production data before the reject-vs-allow
    // decision (plan validation session 1, Q3).
    const activeAssignment = await getActiveAssignment(tx, input.truckId);
    if (activeAssignment != null && activeAssignment.driverId !== input.driverId) {
      console.warn('[dispatch-driver-mismatch]', JSON.stringify({
        truckId: input.truckId,
        issuedDriverId: input.driverId,
        activeAssignmentDriverId: activeAssignment.driverId,
      }));
    }
    const trailerCandidateId = input.trailerId ?? truck.currentTrailerId ?? null;
    if (trailerCandidateId == null) {
      throw new ApiError(409, 'Xe đầu kéo chưa có rơ-moóc khả dụng.');
    }
    const [trailer] = await tx.select({
      id: s.trailers.id,
      type: s.trailers.type,
      status: s.trailers.status,
      deletedAt: s.trailers.deletedAt,
    }).from(s.trailers).where(eq(s.trailers.id, trailerCandidateId)).limit(1);
    if (!trailer || trailer.deletedAt || trailer.status !== 'ACTIVE') {
      throw new ApiError(409, 'Rơ-moóc không còn hiệu lực.');
    }
    const resolvedTrailerType = trailer.type ?? truck.trailerType;
    vehicleCapacityKg = inferredVehicleCapacityKg(resolvedTrailerType);
    if (fulfillment.shipmentContainerId != null) {
      const [container] = await tx.select({
        code: s.containerTypes.code,
        containerTypeId: s.shipmentContainers.containerTypeId,
        cargoWeightKg: s.shipmentContainers.cargoWeightKg,
      })
        .from(s.shipmentContainers)
        .leftJoin(s.containerTypes, eq(s.shipmentContainers.containerTypeId, s.containerTypes.id))
        .where(eq(s.shipmentContainers.id, fulfillment.shipmentContainerId))
        .limit(1);
      // Master-data imports usually leave Loại Moóc blank (see trailers.type
      // comment) — only block on a mismatch we can actually prove, not on
      // missing data.
      if (
        container?.code
        && resolvedTrailerType != null
        && resolvedTrailerType !== inferTrailerTypeFromContainerCode(container.code)
      ) {
        throw new ApiError(409, 'Rơ-moóc không phù hợp với loại container.');
      }
      containerTypeId = container?.containerTypeId ?? containerTypeId;
      cargoWeightKg = authoritativeCargoWeightKg({
        shipmentCargoWeightKg: shipment.cargoWeightKg,
        containerCargoWeightKg: container?.cargoWeightKg ?? null,
        shipmentContainerId: fulfillment.shipmentContainerId,
      });
    }
    if (
      cargoWeightKg != null
      && vehicleCapacityKg != null
      && Number(cargoWeightKg) > Number(vehicleCapacityKg)
    ) {
      throw new ApiError(409, 'Trọng lượng hàng vượt quá tải trọng xe.');
    }
    truckId = truck.id;
    trailerId = trailer.id;
    driverId = driver.id;
  } else {
    // Input-first partner resolution: an explicit externalCarrierId in the
    // issue/reissue payload wins over the CUS-planned partner; the planned id
    // is the fallback so partner-less payloads keep the planned partner.
    externalCarrierId = input.externalCarrierId ?? fulfillment.plannedExternalCarrierId ?? null;
    if (externalCarrierId == null) throw new ApiError(409, 'Tác vụ chưa có nhà xe ngoài hợp lệ.');
    const [carrier] = await tx.select({
      id: s.customers.id,
      isCarrier: s.customers.isCarrier,
      status: s.customers.status,
      deletedAt: s.customers.deletedAt,
    }).from(s.customers).where(eq(s.customers.id, externalCarrierId)).limit(1);
    if (!carrier || carrier.deletedAt || carrier.status !== 'ACTIVE' || !carrier.isCarrier) {
      throw new ApiError(409, 'Nhà xe ngoài không còn hiệu lực.');
    }
    externalCarrierVehicleId = input.externalCarrierVehicleId ?? null;
    const [carrierVehicle] = externalCarrierVehicleId == null
      ? []
      : await tx.select().from(s.carrierFleetVehicles)
        .where(and(
          eq(s.carrierFleetVehicles.id, externalCarrierVehicleId),
          eq(s.carrierFleetVehicles.carrierId, externalCarrierId),
          eq(s.carrierFleetVehicles.isActive, true),
          isNull(s.carrierFleetVehicles.deletedAt),
        ))
        .limit(1)
        .for('update');
    if (externalCarrierVehicleId != null && !carrierVehicle) {
      throw new ApiError(409, 'Xe không thuộc nhà xe đã gán hoặc không còn hoạt động.');
    }
    externalPlateNumber = carrierVehicle?.licensePlate
      ?? trimBounded(input.externalPlateNumber, 'Biển số xe ngoài', 20);
    // Driver identity is optional since 2026-09-08: external carriers don't
    // use the driver app, so the name/phone are informational only — the trip
    // is completed by dispatch/CUS on the driver's behalf (trips complete-external).
    externalDriverName = trimBounded(input.externalDriverName, 'Tên tài xế ngoài', 100);
    externalDriverPhone = trimBounded(input.externalDriverPhone, 'Số điện thoại tài xế ngoài', 20);
    if (!externalPlateNumber) {
      throw new ApiError(400, 'Điều xe ngoài phải có biển số xe.');
    }
  }

  const lockIds = [truckId, trailerId, driverId].filter((id): id is number => id != null).sort((a, b) => a - b);
  for (const resourceId of [...new Set(lockIds)]) {
    await tx.execute(sql`select pg_advisory_xact_lock(6201, ${resourceId})`);
  }

  const liveTrip = await loadLiveTripForFulfillment(tx, fulfillment.id);
  if (liveTrip && liveTrip.status !== TripStatus.CREATED) {
    if (!input.allowUnacknowledgedDeparture) {
      throw new ApiError(409, 'Không thể điều chỉnh tác vụ đã xuất phát.');
    }
    // Reassignment relaxation (TODO/20260911_2 BUG1): an ops "xuất phát"
    // (POST /trips/:id/dispatch) can flip the trip to IN_TRANSIT before any
    // driver acknowledgement, so status alone must not block the correction.
    // COMPLETED stays terminal, and IN_TRANSIT blocks only once the assigned
    // driver acknowledged the order.
    if (
      liveTrip.status === TripStatus.COMPLETED
      || await tripHasDriverAcknowledgement(tx, liveTrip.id)
    ) {
      throw new ApiError(409, liveTrip.status === TripStatus.COMPLETED
        ? 'Không thể điều chỉnh tác vụ đã hoàn thành.'
        : 'Không thể điều chỉnh tác vụ đã được lái xe nhận việc.');
    }
  }
  if (liveTrip && input.expectedTripVersion !== undefined && liveTrip.version !== input.expectedTripVersion) {
    throw new ApiError(409, 'Lệnh điều xe đã thay đổi. Vui lòng tải lại.');
  }
  const previousDriverId = liveTrip?.driverId ?? null;
  const assignmentChanged = liveTrip == null
    ? true
    : dispatchAssignmentChanged(liveTrip, {
      plannedStartAt,
      plannedEndAt,
      carrierType: input.carrierType,
      truckId,
      trailerId,
      driverId,
      externalCarrierId,
      externalPlateNumber,
      externalDriverName,
      externalDriverPhone,
    });

  await assertResourceAvailability(tx, {
    tripId: liveTrip?.id ?? null,
    truckId,
    trailerId,
    driverId,
    plannedStartAt,
    plannedEndAt,
    // Kẹp eligibility rides the issuing container's shell size: only a 20'
    // shell may share its truck/trailer/driver window with another 20' trip
    // on the same departure day (the pairing partner).
    kepContext: {
      issuingContainerIsTwentyFoot: (containerRoute?.containerTypeCode ?? '').startsWith('20'),
      departureDate: plannedStartAt.toISOString().slice(0, 10),
    },
  });

  let trip = liveTrip;
  let notificationPersisted = false;

  if (!trip) {
    // Ad-hoc shipments carry no catalog customer; a trip row requires one
    // until the trips schema relaxes. Fail with an explicit, actionable
    // message instead of a DB constraint 500.
    if (shipment.customerId == null) {
      throw new ApiError(
        400,
        'Lô chạy ngoài chưa có khách hàng trên danh mục — chưa thể phát lệnh chuyến.',
      );
    }
    const createdTrip = await createTrip({
      customerId: shipment.customerId,
      routeId: effectiveRouteId,
      truckId,
      driverId,
      cargoTypeId,
      departureDate: plannedStartAt.toISOString().slice(0, 10),
      customerReference: shipment.bookingRef ?? shipment.blNumber ?? undefined,
      containerCount: 1,
      containerTypeId,
      pricingRateKey: input.pricingRateKey ?? null,
      fuelMode: input.fuelMode,
      createdBy: input.actor.userId,
      carrierType: input.carrierType,
      externalCarrierId,
      externalPlateNumber,
      externalDriverName,
      externalDriverPhone,
      trailerId,
    }, tx);
    const { ops: linkedTripOps, carrier: linkedTripCarrier } = splitTripPatch({
      shipmentId: shipment.id,
      fulfillmentId: fulfillment.id,
      sourceShipmentVersion: shipment.version,
      plannedStartAt,
      plannedEndAt,
      truckId,
      trailerId,
      driverId,
      carrierType: input.carrierType,
      externalEntityId: externalCarrierId,
      externalEntityType: externalCarrierId != null ? 'CUSTOMER' : null,
      externalPlateNumber,
      externalDriverName,
      externalDriverPhone,
      externalCarrierVehicleId,
      cargoWeightKg,
      vehicleCapacityKg,
      version: sql`${s.trips.version} + 1`,
      updatedAt: new Date(),
    });
    // Trips-split: guarded ops update keeps the pre-split guard + version
    // bump; carrier fields route to the sidecar upsert.
    const [linkedOpsRow] = await tx.update(s.trips)
      .set(linkedTripOps as typeof s.trips.$inferInsert)
      .where(eq(s.trips.id, createdTrip.id)).returning({ id: s.trips.id });
    if (!linkedOpsRow) throw new ApiError(409, 'Không thể liên kết chuyến với tác vụ.');
    await upsertTripCarrierInfo(tx, createdTrip.id, linkedTripCarrier);
    const linked = await getTripCompositeInTx(tx, createdTrip.id);
    trip = linked ? toLiveTripRow(linked) : null;
    if (!trip) throw new ApiError(409, 'Không thể liên kết chuyến với tác vụ.');
    await replaceTripContainersForFulfillment(tx, trip.id, shipment, fulfillment, input.actor.userId);
    // Auto freight pricing: the dispatch order is the definitive rate lock —
    // the dispatcher's rate key (else the fulfillment container's class) at
    // the container's own appointment date, falling back to the shipment's
    // transport date and finally the planned start day. Supersedes any
    // intake-time snapshot; MANUAL fallback never blocks the order.
    await lockShipmentFreightRate(tx, {
      shipmentId: shipment.id,
      tripId: trip.id,
      shipmentContainerId: fulfillment.shipmentContainerId,
      rateKeyOverride: input.pricingRateKey ?? null,
      fallbackTransportDate: localDateInBusinessZone(plannedStartAt),
    });
    // F6 factory snapshot (MDN-13): freeze the operational site's display
    // fields at dispatch so later master-data edits cannot drift an
    // in-flight lot. Same doctrine as the trips.route_id route snapshot.
    const factorySnapshot = await resolveDispatchFactorySnapshot(tx, {
      shipmentId: shipment.id,
      shipmentContainerId: fulfillment.shipmentContainerId,
    });
    if (factorySnapshot) {
      await tx.update(s.trips).set({
        factorySiteName: factorySnapshot.name,
        factorySiteAddress: factorySnapshot.address,
      }).where(eq(s.trips.id, trip.id));
    }
    const notificationPayload = buildNotificationPayload(trip);
    if (hasExplicitNotificationTarget(notificationPayload)) {
      await persistNotificationInTx(tx, notificationPayload);
      notificationPersisted = true;
    }
  } else {
    const { ops: updatedTripOps, carrier: updatedTripCarrier } = splitTripPatch({
      plannedStartAt,
      plannedEndAt,
      truckId,
      trailerId,
      driverId,
      carrierType: input.carrierType,
      externalEntityId: externalCarrierId,
      externalEntityType: externalCarrierId != null ? 'CUSTOMER' : null,
      externalPlateNumber,
      externalDriverName,
      externalDriverPhone,
      externalCarrierVehicleId,
      sourceShipmentVersion: shipment.version,
      cargoWeightKg,
      vehicleCapacityKg,
      version: sql`${s.trips.version} + 1`,
      updatedAt: new Date(),
    });
    // Trips-split: guarded ops update + sidecar upsert; the composed re-read
    // preserves the pre-split behavior where `.returning(LIVE_TRIP_RETURNING)`
    // handed the fresh carrier block to the notification builder.
    const [updatedOpsRow] = await tx.update(s.trips)
      .set(updatedTripOps as typeof s.trips.$inferInsert)
      .where(eq(s.trips.id, trip.id)).returning({ id: s.trips.id });
    if (updatedOpsRow) {
      await upsertTripCarrierInfo(tx, trip.id, updatedTripCarrier);
      const composed = await getTripCompositeInTx(tx, trip.id);
      if (composed) trip = toLiveTripRow(composed);
    }
    await replaceTripContainersForFulfillment(tx, trip.id, shipment, fulfillment, input.actor.userId);
    const existingNotificationCount = await tx.select({ total: count() }).from(s.notifications).where(and(
      eq(s.notifications.type, 'TRIP_DISPATCHED'),
      eq(s.notifications.relatedEntityType, 'shipment_fulfillments'),
      eq(s.notifications.relatedEntityId, fulfillment.id),
      driverUserId != null ? eq(s.notifications.userId, driverUserId) : undefined,
    ));
    if (
      assignmentChanged
      && (
        driverUserId == null
          ? Number(existingNotificationCount[0]?.total ?? 0) === 0
          : previousDriverId !== driverId && Number(existingNotificationCount[0]?.total ?? 0) === 0
      )
    ) {
      const notificationPayload = buildNotificationPayload(trip);
      if (hasExplicitNotificationTarget(notificationPayload)) {
        await persistNotificationInTx(tx, notificationPayload);
        notificationPersisted = true;
      }
    }
  }

  const [updatedFulfillment] = await tx.update(s.shipmentFulfillments).set({
    plannedCarrierType: input.carrierType,
    plannedExternalCarrierId: externalCarrierId,
    plannedExternalCarrierVehicleId: externalCarrierVehicleId,
    plannedVehiclePlateNumber: input.carrierType === 'OWN'
      ? (await tx.select({ licensePlate: s.trucks.licensePlate }).from(s.trucks).where(eq(s.trucks.id, truckId!)).limit(1))[0]?.licensePlate ?? null
      : externalPlateNumber,
    version: sql`${s.shipmentFulfillments.version} + 1`,
    updatedAt: new Date(),
  }).where(eq(s.shipmentFulfillments.id, fulfillment.id)).returning();

  if (canonicalShipmentStatus(shipment.status) === 'READY_FOR_DISPATCH') {
    await transitionShipmentStatus(
      shipment.id,
      'DISPATCHED',
      {
        reason: 'Phát hành lệnh điều xe.',
        changedBy: input.actor.userId,
      },
      tx,
    );
  }

  const departedDriverChanged = input.allowUnacknowledgedDeparture
    && liveTrip != null
    && liveTrip.status !== TripStatus.CREATED
    && (liveTrip.driverId ?? null) !== (driverId ?? null);

  return {
    fulfillment: updatedFulfillment ?? fulfillment,
    trip,
    notificationPersisted,
    ...(departedDriverChanged ? {
      attendanceResync: {
        tripId: trip.id,
        previousDriverId: liveTrip?.driverId ?? null,
        driverId: driverId ?? null,
        departureDate: trip.departureDate ?? null,
      },
    } : {}),
  };
}


export async function issueFulfillmentDispatchOrder(input: IssueFulfillmentDispatchOrderInput) {
  assertDispatchActor(input.actor);
  const outcome = await runIdempotent<IssueOrderMutationResult>({
    endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_DISPATCH,
    idempotencyKey: input.idempotencyKey,
    payload: {
      shipmentId: input.shipmentId,
      fulfillmentId: input.fulfillmentId,
      expectedVersion: input.expectedVersion,
      expectedTripVersion: input.expectedTripVersion ?? null,
      plannedStartAt: input.plannedStartAt,
      plannedEndAt: input.plannedEndAt,
      endTimeConfirmed: input.endTimeConfirmed,
      carrierType: input.carrierType,
      cargoTypeId: input.cargoTypeId ?? null,
      truckId: input.truckId ?? null,
      driverId: input.driverId ?? null,
      trailerId: input.trailerId ?? null,
      containerTypeId: input.containerTypeId ?? null,
      pricingRateKey: input.pricingRateKey ?? null,
      externalCarrierId: input.externalCarrierId ?? null,
      externalCarrierVehicleId: input.externalCarrierVehicleId ?? null,
      externalPlateNumber: input.externalPlateNumber ?? null,
      externalDriverName: input.externalDriverName ?? null,
      externalDriverPhone: input.externalDriverPhone ?? null,
    },
    createdBy: input.actor.userId,
    entityType: 'trip',
    getEntityId: (result) => result.trip.id,
    create: (tx) => issueOrderCreateOrUpdate(tx, input),
  });

  const notificationPayload = buildNotificationPayload(outcome.result.trip);
  const hasExplicitInAppTarget = hasExplicitNotificationTarget(notificationPayload);

  // Reassignment of a departed-but-unacknowledged trip: the ops "Phát lệnh"
  // stamped the OLD driver's attendance work-days, so re-key them to the new
  // driver. Best-effort and outside the write transaction — an attendance
  // failure must never block the reassignment (same contract as
  // syncAttendanceAfterStatusChange).
  if (!outcome.replayed && outcome.result.attendanceResync) {
    const resync = outcome.result.attendanceResync;
    try {
      if (resync.previousDriverId != null) {
        await removeTripWorkDays(resync.previousDriverId, resync.tripId);
      }
      if (resync.driverId != null && resync.departureDate != null) {
        await syncTripWorkDays(resync.driverId, resync.tripId, resync.departureDate, null, input.actor.userId);
      }
    } catch (error) {
      console.warn('[attendance] reassignment resync failed for trip', resync.tripId, error);
    }
  }

  if (!outcome.replayed && outcome.result.notificationPersisted && hasExplicitInAppTarget) {
    await sendNotificationPush(notificationPayload).catch((error) => {
      console.error('Dispatch push delivery failed after order commit:', error);
    });
  }

  return {
    fulfillmentId: outcome.result.fulfillment.id,
    version: outcome.result.fulfillment.version,
    trip: {
      id: outcome.result.trip.id,
      version: outcome.result.trip.version,
      tripCode: outcome.result.trip.tripCode,
      status: outcome.result.trip.status,
      plannedStartAt: toIsoOrNull(outcome.result.trip.plannedStartAt),
      plannedEndAt: toIsoOrNull(outcome.result.trip.plannedEndAt),
      carrierType: outcome.result.trip.carrierType,
      truckId: outcome.result.trip.truckId,
      trailerId: outcome.result.trip.trailerId,
      driverId: outcome.result.trip.driverId,
      externalCarrierId: outcome.result.trip.externalEntityId,
      externalPlateNumber: outcome.result.trip.externalPlateNumber,
      externalDriverName: outcome.result.trip.externalDriverName,
      externalDriverPhone: outcome.result.trip.externalDriverPhone,
    },
    notification: {
      type: NotificationType.TRIP_DISPATCHED,
      deliveredInApp: hasExplicitInAppTarget,
      pushAttempted: !outcome.replayed && outcome.result.notificationPersisted && hasExplicitInAppTarget,
    },
    replayed: outcome.replayed,
  };
}

/**
 * Command boundary for correcting a published fulfillment before departure.
 * It deliberately reuses the issuance transaction so reassignment keeps the
 * same validation, optimistic locking, fulfillment projection, and durable
 * notification guarantees as first-time dispatch.
 */

export async function reassignIssuedDispatchWriteCommand(input: IssueFulfillmentDispatchOrderInput) {
  return issueFulfillmentDispatchOrder({ ...input, allowUnacknowledgedDeparture: true });
}

// ─── Dispatch detail plan grid ("Kế hoạch Chi tiết Xe") ─────────────────────
// One row per active fulfillment (container or LCL shipment). Rows exist as
// soon as CUS allocates a carrier on the master-plan screen (READY_FOR_DISPATCH
// with plannedCarrierType set), before any handoff resolution or trip — so
// unlike listDispatchQueue there is NO accepted-handoff join here.


// ─── Dispatch detail plan grid ("Kế hoạch Chi tiết Xe") ─────────────────────
// One row per active fulfillment (container or LCL shipment). Rows exist as
// soon as CUS allocates a carrier on the master-plan screen (READY_FOR_DISPATCH
// with plannedCarrierType set), before any handoff resolution or trip — so
// unlike listDispatchQueue there is NO accepted-handoff join here.

export const DISPATCH_DETAIL_PLAN_CARRIER_TYPES = ['OWN', 'EXTERNAL'] as const;

export interface CompleteExternalCarrierDispatchOrderInput {
  fulfillmentId: number;
  expectedTripVersion?: number;
  actor: { userId: number; role: Role };
}

export async function completeExternalCarrierDispatchOrder(
  input: CompleteExternalCarrierDispatchOrderInput,
) {
  const [liveTrip] = await db.select({ id: s.trips.id })
    .from(s.trips)
    .where(and(
      eq(s.trips.fulfillmentId, input.fulfillmentId),
      ne(s.trips.status, TripStatus.CANCELED),
      isNull(s.trips.deletedAt),
    ))
    .limit(1);
  if (!liveTrip) {
    throw new ApiError(404, 'Không tìm thấy chuyến đi cho tác vụ này.');
  }

  const { trip, replayed } = await completeExternalCarrierTrip({
    tripId: liveTrip.id,
    actorUserId: input.actor.userId,
    actorRole: input.actor.role,
    expectedVersion: input.expectedTripVersion,
  });

  return { ok: true, tripId: trip.tripId, fulfillmentId: input.fulfillmentId, replayed };
}

