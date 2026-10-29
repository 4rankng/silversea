import { and, eq, inArray, isNotNull, isNull, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import { localDateInBusinessZone, TripStatus } from '@tingting/shared';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { Tx } from './dispatch-planning-utils.service';

/**
 * Law owner (FB-038/072, third verify-fail): the window a TRIP claims its rig
 * for, shared by every rig-overlap guard. A trip carrying a staged start owns
 * [start, end ?? start+8h); a trip WITHOUT one still claims its whole
 * departure day (Asia/Ho_Chi_Minh) — the same day the dispatcher reads in the
 * grid. Before this, every completed/active scan required `plannedStartAt`,
 * and trips created through the trip form, imports or the legacy flow carry
 * only `departureDate` (in the mirrored data ~94% of COMPLETED trips): a
 * same-day same-tractor assignment against any of them saved with no warning.
 * A day claim is weak evidence, so it can only ever WARN (never hard-block).
 */
export const tripDayStartSql = sql`((${s.trips.departureDate})::timestamp at time zone 'Asia/Ho_Chi_Minh')`;
export const tripClaimStartSql = sql`coalesce(${s.trips.plannedStartAt}, ${tripDayStartSql})`;
export const tripClaimEndSql = sql`coalesce(${s.trips.plannedEndAt}, ${s.trips.plannedStartAt} + interval '8 hours', ${tripDayStartSql} + interval '1 day')`;

/**
 * COMPLETED trips with NO staged start whose departure day overlaps the saving
 * window, on the given rig predicates. Timestamped holders stay with each
 * guard's own (stronger-evidence) scans. Live trips are deliberately NOT swept
 * in: a live trip without a start "cannot prove overlap" at the issue/reassign
 * gate (pinned by T9 in dispatch-resource-availability-kep-kethop), and an
 * issued trip's plan row already holds the plate in the plan-row scan.
 */
export async function countDateOnlyTripClaims(tx: Tx, args: {
  predicates: SQL[];
  windowStart: Date;
  windowEnd: Date;
  excludeTripId?: number | null;
  excludeFulfillmentId?: number | null;
}): Promise<number> {
  if (args.predicates.length === 0) return 0;
  const rows = await tx.select({ id: s.trips.id }).from(s.trips).where(and(
    or(...args.predicates)!,
    isNull(s.trips.deletedAt),
    isNull(s.trips.plannedStartAt),
    eq(s.trips.status, TripStatus.COMPLETED),
    args.excludeTripId != null ? ne(s.trips.id, args.excludeTripId) : undefined,
    args.excludeFulfillmentId != null
      ? or(isNull(s.trips.fulfillmentId), ne(s.trips.fulfillmentId, args.excludeFulfillmentId))
      : undefined,
    sql`${tripClaimStartSql} < ${args.windowEnd.toISOString()}::timestamptz`,
    sql`${tripClaimEndSql} > ${args.windowStart.toISOString()}::timestamptz`,
  ));
  return rows.length;
}

/**
 * SIL-591 (id 691) — the pure half of the ghép-trả-ĐV carve-out: which
 * blocking holders are the issuing lot's OWN cost-group siblings. Sibling
 * lots of ONE ghép group share one physical run (one BKS thực, one driver,
 * one slot) BY DESIGN — the dispatcher merged them, so their trips overlap
 * on the rig on purpose, not by accident. `ownCostGroupId == null` (an
 * ungrouped lot) carves nothing; a holder in a DIFFERENT group or with no
 * group stays blocking (never a third load on the group's rig).
 */
export function sameCostGroupSiblings<T extends { id: number; costGroupId: string | null }>(
  rows: readonly T[],
  ownCostGroupId: string | null,
): T[] {
  if (ownCostGroupId == null) return [];
  return rows.filter((row) => row.costGroupId != null && row.costGroupId === ownCostGroupId);
}

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
  /**
   * Card 061026172804 warn-once contract: the completed-trip overlap refusal
   * was acknowledged in the dialog and this is the confirmed retry. Shares the
   * name the plan-save and plate endpoints already use so one flag covers the
   * family.
   */
  rigOverlapCompletedConfirmed?: boolean;
  /**
   * SIL-591 (id 691) — the issuing lot's ghép-trả-ĐV group id. Sibling lots
   * of ONE cost group share ONE physical run on purpose (one BKS thực, one
   * driver, one slot) — a sibling's ACTIVE trip is the arrangement itself,
   * never a foreign claim, so it must not hard-block the group's second
   * issue with "Xe đầu kéo đã bị trùng lịch kế hoạch". The plan-row guard
   * already treats same-group as non-conflict (isSameGroup); this gate now
   * agrees. Null = ungrouped lot, nothing is carved out.
   */
  costGroupId?: string | null;
  kepContext?: {
    issuingContainerIsTwentyFoot: boolean;
    classification: string;
    departureDate: string | null;
  } | null;
  /**
   * SPEC 18/10/2026 / card 181026145600 — the lot being issued. The plan-row
   * guard has always warned (confirmable) when the only overlapping holder is
   * another container of the SAME lot; this trip-side gate then hard-blocked
   * the confirmed retry with "trùng lịch kế hoạch". Carrying the shipment id
   * lets the same warning law apply here without weakening cross-lot blocks.
   */
  shipmentId?: number | null;
}) {
  const predicates = [];
  if (args.truckId != null) predicates.push(eq(s.trips.truckId, args.truckId));
  if (args.trailerId != null) predicates.push(eq(s.trips.trailerId, args.trailerId));
  if (args.driverId != null) predicates.push(eq(s.trips.driverId, args.driverId));
  if (predicates.length === 0) return;

  // Card 081026230530 (FB-038 round 8): an ACTIVE trip issued without an end
  // time is a real rig occupant — the hard isNotNull(plannedEndAt) made it
  // invisible here, so a governed reassign saved a same-rig double-booking
  // silently. Follow the plan-row guard's law (card 061026172804): an
  // open-ended window occupies the rig for one 8-hour shift from its start;
  // a trip without a start still cannot prove overlap and stays skipped.
  const conflicts = await tx.select({
    id: s.trips.id,
    truckId: s.trips.truckId,
    trailerId: s.trips.trailerId,
    driverId: s.trips.driverId,
    plannedStartAt: s.trips.plannedStartAt,
    shipmentId: s.shipmentFulfillments.shipmentId,
    costGroupId: s.shipments.costGroupId,
    classification: s.shipmentFulfillments.dispatchClassification,
    activePairId: s.trips.activeTripPairId,
    pairStatus: s.tripPairs.status,
    pairKind: s.tripPairs.pairKind,
    pairFirstTripId: s.tripPairs.firstTripId,
    pairSecondTripId: s.tripPairs.secondTripId,
  }).from(s.trips)
    .leftJoin(s.shipmentFulfillments, eq(s.shipmentFulfillments.id, s.trips.fulfillmentId))
    .leftJoin(s.shipments, eq(s.shipments.id, s.shipmentFulfillments.shipmentId))
    .leftJoin(s.tripPairs, eq(s.tripPairs.id, s.trips.activeTripPairId))
    .where(and(
      or(...predicates)!,
      isNull(s.trips.deletedAt),
      inArray(s.trips.status, [TripStatus.CREATED, TripStatus.IN_TRANSIT]),
      args.tripId != null ? ne(s.trips.id, args.tripId) : undefined,
      isNotNull(s.trips.plannedStartAt),
      lt(s.trips.plannedStartAt, args.plannedEndAt),
      sql`coalesce(${s.trips.plannedEndAt}, ${s.trips.plannedStartAt} + interval '8 hours') > ${args.plannedStartAt.toISOString()}::timestamptz`,
    ));

  let blocking = conflicts;
  const partner = conflicts.length === 1 ? conflicts[0] : undefined;
  // dis-03 (card 211026131857): set by the mixed-declaration candidate block
  // below — the confirmable warn tier for a deliberate kẹp share.
  let kepCandidateWarn = false;
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
  // dis-03 (card 211026131857) — the mixed-declaration kẹp candidate: the
  // issuing leg is declared Kẹp (20', one same-rig partner, same truck +
  // trailer + driver + day) but the partner's own leg was issued without the
  // Kẹp declaration. The share is the dispatcher's deliberate arrangement,
  // not a foreign claim — it rides the FB-012 warn-once contract (confirmable)
  // instead of dead-ending on the hard "trùng lịch kế hoạch" tier. The weight
  // gate still applies: an overweight pair never rides, confirmed or not.
  if (partner && kep != null && declaredMode === 'KEP' && kep.departureDate != null
    && partner.classification !== 'DOUBLE'
    && args.truckId != null && partner.truckId === args.truckId
    && args.trailerId != null && partner.trailerId === args.trailerId
    && args.driverId != null && partner.driverId === args.driverId
    && partner.plannedStartAt != null
    && localDateInBusinessZone(partner.plannedStartAt) === kep.departureDate
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
      kepCandidateWarn = true;
    }
  }
  // FB-081 v2 (card 181026003045, owner option 2-lite): the remaining leg of
  // the reassigning trip's OWN ACTIVE Kẹp pair overlaps BY CONSTRUCTION — the
  // pairing gate itself forces both legs onto one truck + one driver. The
  // declared carve-out above only admitted the frozen state (absolute 3-way
  // match, exactly one conflict), so every real transition — driver first,
  // truck first, a mooc resolving differently — fell out of it and 409'd
  // hard with no confirm code: a Kẹp pair could never move. The reassign
  // write commands now apply the new rig to BOTH legs in one transaction
  // (propagateKepPairRigToPartner), so the partner's overlap is the
  // arrangement itself. Carve out exactly that one linked row; any OTHER
  // overlapping load still blocks (never a third load), KET_HOP pairs get no
  // carve-out (owner ruling Q4 — sequential windows), and the 2×20' weight
  // gate still applies to the pair's combined load on the incoming rig.
  if (args.tripId != null && blocking.length > 0) {
    const incomingDay = localDateInBusinessZone(args.plannedStartAt);
    const isOwnKepPartner = (row: typeof conflicts[number]) => row.activePairId != null
      && row.pairStatus === 'ACTIVE'
      && row.pairKind === 'KEP'
      && (row.pairFirstTripId === args.tripId || row.pairSecondTripId === args.tripId)
      && row.plannedStartAt != null
      && localDateInBusinessZone(row.plannedStartAt) === incomingDay;
    const partnerRows = blocking.filter(isOwnKepPartner);
    if (partnerRows.length > 0) {
      const carvedPartnerIds = new Set<number>();
      for (const partner of partnerRows) {
        // Same physical probe as the declared clamp above: a partner that no
        // longer reads as one 20' shell is a data anomaly, not the pair's
        // deliberate overlap — it stays a conflict rather than being trusted.
        const containers = await tx.select({ code: s.containerTypes.code, weight: s.tripContainers.cargoWeightKg })
          .from(s.tripContainers)
          .leftJoin(s.containerTypes, eq(s.containerTypes.id, s.tripContainers.containerTypeId))
          .where(eq(s.tripContainers.tripId, partner.id));
        if (!(containers.length === 1 && containers[0].code?.startsWith('20'))) continue;
        const weights = [args.cargoWeightKg, containers[0].weight];
        if (args.vehicleCapacityKg != null && weights.every((weight) => weight != null && Number.isFinite(Number(weight)))
          && weights.reduce((sum, weight) => sum + Number(weight), 0) > Number(args.vehicleCapacityKg)) {
          throw new ApiError(409, 'Tổng trọng lượng hai container kẹp vượt quá tải trọng xe.');
        }
        carvedPartnerIds.add(partner.id);
      }
      if (carvedPartnerIds.size > 0) {
        blocking = blocking.filter((row) => !carvedPartnerIds.has(row.id));
      }
    }
  }
  // Card 181026145600 (FB-012 regression) — the sibling-container case. The
  // plan-row guard warns "đã được gán cho container khác của lô này … Vẫn
  // lưu?" and accepts the confirmed retry; this gate then hard-blocked that
  // retry. Split same-lot holders out: cross-lot holders keep the hard block,
  // a same-lot holder warns once (RIG_OVERLAP_COMPLETED) and the confirmed
  // retry proceeds. Without a shipment context nothing is carved out.
  const sameLotBlocking = args.shipmentId == null
    ? []
    : blocking.filter((row) => row.shipmentId === args.shipmentId);
  if (sameLotBlocking.length > 0) {
    blocking = blocking.filter((row) => row.shipmentId !== args.shipmentId);
  }
  // SIL-591 (id 691) — the ghép-trả-ĐV sibling carve-out. The issuing lot's
  // cost-group siblings run the SAME physical trip on purpose: when their
  // ACTIVE trips already hold the truck/trailer/driver, that overlap is the
  // group's arrangement, not a foreign claim — issuing lot 2 of a merged
  // group must never 409 with "đã bị trùng lịch kế hoạch" again. Silent,
  // exactly like the plan-row guard's isSameGroup treatment; a group-external
  // overlap still blocks (never a third load).
  const groupSiblingRows = sameCostGroupSiblings(blocking, args.costGroupId ?? null);
  if (groupSiblingRows.length > 0) {
    const groupSiblingIds = new Set(groupSiblingRows.map((row) => row.id));
    blocking = blocking.filter((row) => !groupSiblingIds.has(row.id));
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
  if (sameLotBlocking.length > 0 && args.rigOverlapCompletedConfirmed !== true) {
    throw new ApiError(
      409,
      'Xe đầu kéo đã được gán cho container khác của lô này trong khung giờ trùng lặp. Vẫn lưu?',
      undefined,
      { code: 'RIG_OVERLAP_COMPLETED' },
    );
  }
  // dis-03 (card 211026131857): the mixed-declaration kẹp candidate carved
  // above — warn once with the family's confirm contract; the confirmed retry
  // proceeds and the dispatcher can pair/reclassify the legs afterwards.
  if (kepCandidateWarn && args.rigOverlapCompletedConfirmed !== true) {
    throw new ApiError(
      409,
      'Xe đầu kéo đã được gán cho lô/tác vụ khác trong khung giờ trùng lặp. Vẫn lưu?',
      undefined,
      { code: 'RIG_OVERLAP_COMPLETED' },
    );
  }

  // Card 061026172804 (FB-038 / REQ-04): a COMPLETED trip of the same rig no
  // longer blocks — the rig is released on completion — but the overlap must
  // never pass silently. The save is refused once carrying the family's
  // warn-once payload so the editor can offer a confirm, and the confirmed
  // retry proceeds (chạy gối đầu onto a finished trip is legal). This gate
  // scanned only CREATED/IN_TRANSIT, so "Phân xe lại" saved a completed-trip
  // overlap with no warning at all — the exact "cảnh báo trùng giờ xe không
  // nổ" symptom, still failing at round 13.
  if (args.rigOverlapCompletedConfirmed !== true) {
    const completedConflicts = await tx.select({ id: s.trips.id, code: s.trips.tripCode })
      .from(s.trips)
      .where(and(
        or(...predicates)!,
        isNull(s.trips.deletedAt),
        eq(s.trips.status, TripStatus.COMPLETED),
        isNotNull(s.trips.plannedStartAt),
        lt(s.trips.plannedStartAt, args.plannedEndAt),
        sql`coalesce(${s.trips.plannedEndAt}, ${s.trips.plannedStartAt} + interval '8 hours') > ${args.plannedStartAt.toISOString()}::timestamptz`,
      ));
    if (completedConflicts.length > 0) {
      throw new ApiError(409,
        `Có ${completedConflicts.length} chuyến đã hoàn thành trùng khung giờ phân công này. Vẫn lưu?`,
        undefined,
        { code: 'RIG_OVERLAP_COMPLETED' });
    }
    // Third verify-fail (FB-038/072): every scan above needs a staged start on
    // the holder, so a same-day COMPLETED trip carrying only its departure day
    // (the shape of most COMPLETED trips) stayed invisible and the reassign saved with no
    // warning. Such a holder claims its whole departure day — weak evidence, so
    // it warns once and the confirmed retry proceeds (rig identity only: the
    // driver's multi-trip day is deliberately not nagged here).
    const dayClaims = await countDateOnlyTripClaims(tx, {
      predicates: [
        ...(args.truckId != null ? [eq(s.trips.truckId, args.truckId)] : []),
        ...(args.trailerId != null ? [eq(s.trips.trailerId, args.trailerId)] : []),
      ],
      windowStart: args.plannedStartAt,
      windowEnd: args.plannedEndAt,
      excludeTripId: args.tripId,
    });
    if (dayClaims > 0) {
      throw new ApiError(409,
        `Xe đã có ${dayClaims} chuyến khác (chưa có giờ cụ thể) trong ngày phân công này. Vẫn lưu?`,
        undefined,
        { code: 'RIG_OVERLAP_COMPLETED' });
    }
  }
}
