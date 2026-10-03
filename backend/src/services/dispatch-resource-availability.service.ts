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
  // A declared clamp (Kẹp: two 20' boxes sharing one mooc simultaneously)
  // or declared sequence (Kết hợp: the rig runs its two orders back-to-back
  // inside one business day) may share its OWN rig — never a third load.
  // Both sides must carry the matching declaration: an unrelated single
  // overlap on the rig stays a conflict, and a partner already paired to a
  // third load stays a conflict. Pairs are created after both trips exist,
  // so an unpaired partner passes the linkage conjunct.
  const kep = args.kepContext;
  const declaredMode: 'KEP' | 'KET_HOP' | null = kep?.classification === 'COMBINED'
    ? 'KET_HOP'
    : kep?.classification === 'DOUBLE' && kep.issuingContainerIsTwentyFoot ? 'KEP' : null;
  if (partner && kep != null && declaredMode != null
    && kep.departureDate != null
    && partner.classification === (declaredMode === 'KEP' ? 'DOUBLE' : 'COMBINED')
    && args.truckId != null && partner.truckId === args.truckId
    && args.trailerId != null && partner.trailerId === args.trailerId
    && args.driverId != null && partner.driverId === args.driverId
    && partner.plannedStartAt != null
    && localDateInBusinessZone(partner.plannedStartAt) === kep.departureDate
    && (partner.activePairId == null || (args.tripId != null
      && (partner.pairFirstTripId === args.tripId || partner.pairSecondTripId === args.tripId)))
  ) {
    if (declaredMode === 'KEP') {
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
    } else {
      // Kết hợp: sequential reuse — the two loads never sit on the mooc at
      // the same instant, so neither the 20' probe nor the weight sum applies.
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
