import { and, eq, gt, inArray, isNotNull, isNull, lt, ne, or } from 'drizzle-orm';
import { localDateInBusinessZone, TripStatus } from '@tingting/shared';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { Tx } from './dispatch-planning-utils.service';

/** A Kẹp release may overlap its one compatible partner, never a third load. */
export async function assertResourceAvailability(tx: Tx, args: {
  tripId: number | null;
  truckId: number | null;
  trailerId: number | null;
  driverId: number | null;
  plannedStartAt: Date;
  plannedEndAt: Date;
  cargoWeightKg: string | null;
  vehicleCapacityKg: string | null;
  kepContext?: {
    issuingContainerIsTwentyFoot: boolean;
    classification: string;
    departureDate: string | null;
  } | null;
}) {
  const predicates = [];
  if (args.truckId != null) predicates.push(eq(s.trips.truckId, args.truckId));
  if (args.trailerId != null) predicates.push(eq(s.trips.trailerId, args.trailerId));
  if (args.driverId != null) predicates.push(eq(s.trips.driverId, args.driverId));
  if (predicates.length === 0) return;

  const conflicts = await tx.select({
    id: s.trips.id,
    truckId: s.trips.truckId,
    trailerId: s.trips.trailerId,
    driverId: s.trips.driverId,
    plannedStartAt: s.trips.plannedStartAt,
    classification: s.shipmentFulfillments.dispatchClassification,
    activePairId: s.trips.activeTripPairId,
    pairFirstTripId: s.tripPairs.firstTripId,
    pairSecondTripId: s.tripPairs.secondTripId,
  }).from(s.trips)
    .leftJoin(s.shipmentFulfillments, eq(s.shipmentFulfillments.id, s.trips.fulfillmentId))
    .leftJoin(s.tripPairs, eq(s.tripPairs.id, s.trips.activeTripPairId))
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

  let blocking = conflicts;
  const partner = conflicts.length === 1 ? conflicts[0] : undefined;
  if (partner && args.kepContext?.classification === 'DOUBLE'
    && args.kepContext.issuingContainerIsTwentyFoot
    && args.kepContext.departureDate != null
    && partner.classification === 'DOUBLE'
    && args.truckId != null && partner.truckId === args.truckId
    && args.trailerId != null && partner.trailerId === args.trailerId
    && args.driverId != null && partner.driverId === args.driverId
    && partner.plannedStartAt != null
    && localDateInBusinessZone(partner.plannedStartAt) === args.kepContext.departureDate
    && (partner.activePairId == null || (args.tripId != null
      && (partner.pairFirstTripId === args.tripId || partner.pairSecondTripId === args.tripId)))
  ) {
    const containers = await tx.select({ code: s.containerTypes.code, weight: s.tripContainers.cargoWeightKg })
      .from(s.tripContainers)
      .leftJoin(s.containerTypes, eq(s.containerTypes.id, s.tripContainers.containerTypeId))
      .where(eq(s.tripContainers.tripId, partner.id));
    if (containers.length === 1 && containers[0].code?.startsWith('20')) {
      const weights = [args.cargoWeightKg, containers[0].weight];
      if (args.vehicleCapacityKg != null && weights.every((weight) => weight != null && Number.isFinite(Number(weight)))
        && weights.reduce((sum, weight) => sum + Number(weight), 0) > Number(args.vehicleCapacityKg)) {
        throw new ApiError(409, 'Tổng trọng lượng hai container kẹp vượt quá tải trọng xe.');
      }
      blocking = [];
    }
  }
  if (blocking.some((row) => args.truckId != null && row.truckId === args.truckId)) {
    throw new ApiError(409, 'Xe đầu kéo đã bị trùng lịch kế hoạch.');
  }
  if (blocking.some((row) => args.trailerId != null && row.trailerId === args.trailerId)) {
    throw new ApiError(409, 'Rơ-moóc đã bị trùng lịch kế hoạch.');
  }
  if (blocking.some((row) => args.driverId != null && row.driverId === args.driverId)) {
    throw new ApiError(409, 'Tài xế đã bị trùng lịch kế hoạch.');
  }
}
