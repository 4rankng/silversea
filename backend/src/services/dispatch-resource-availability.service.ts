import { and, eq, inArray, isNotNull, isNull, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import { localDateInBusinessZone, TripStatus } from '@tingting/shared';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import {
  busyDayClaimOverlaps,
  busyRigWarnMessage,
  CLASSIFICATION_MISMATCH_SHARE_BLOCK_MESSAGE,
  classificationMismatchShareBlockMessage,
  containerFootClass,
  declaredKepShareMode,
  isDeclaredKepSharePartner,
  isMixedDeclarationKepCandidate,
  kepPairWeightVerdict,
  kepWeightGuardOutcome,
  KEP_CONTAINER_SIZE_BLOCK_MESSAGE,
  KEP_WEIGHT_WARNING_CODE,
  KEP_WEIGHT_WARNING_MESSAGE,
  MIXED_DECLARATION_KEP_WARN_MESSAGE,
} from './trip-pair-rules.service';
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
 * SIL-638 TC1 (QA 01/11) — the operational-lot statuses the plan-row READ
 * shows. Moved here from dispatch-plan-conflict-scan.service (whose header
 * documents itself as an import-cycle leaf) so the SIL-666 round-2 trip-side
 * visibility builder below can share ONE set across both modules without
 * reopening that cycle: dispatch-plan-conflict-scan already imports this
 * module's trip-claim SQL.
 */
export const OPERATIONAL_HOLDER_SHIPMENT_STATUSES = [
  'READY_FOR_DISPATCH', 'DISPATCHED', 'IN_TRANSIT', 'COMPLETED',
] as const;

/**
 * SIL-666 round-2 (QA round-3b 03/11) — the TRIP-side scans obey the same
 * visibility law the plan-row scans got in SIL-638 TC1. A trip whose
 * fulfillment is canceled, or whose lot is deleted / non-operational, is
 * invisible in the plan grid yet still claimed rigs from the shadows: the
 * 31/12 phantom 409 was exactly such a hidden KẸP trip on a deleted lot
 * answering the TC2 mismatch ("Cần cả 2 cont cùng khai báo KẸP…") and naming
 * nothing — date-dependent only because the claim fires on whichever days
 * the hidden trip overlaps. Both left joins are nullable on purpose: a
 * fulfillment-LESS task (BULK) carries no shipment row and MUST keep
 * blocking — SIL-666 round-1 pinned its named hard tier (BULK-TR-0180).
 * Spread into every trip-conflict scan that joins
 * shipment_fulfillments/shipments for identity columns.
 */
export function tripHolderVisibilitySql(): SQL[] {
  return [
    or(isNull(s.shipmentFulfillments.id), isNull(s.shipmentFulfillments.canceledAt))!,
    or(
      isNull(s.shipments.id),
      and(
        isNull(s.shipments.deletedAt),
        inArray(s.shipments.status, [...OPERATIONAL_HOLDER_SHIPMENT_STATUSES]),
      ),
    )!,
  ];
}

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

/**
 * SIL-638 (id 742) TC6(1) — the 40ft-Kẹp hard block at ASSIGN/ISSUE time.
 * The 31/10 patch only fired `kepContainerSizeBlockMessage` inside the pairing
 * core (createTripPairCoreInTx), so a DOUBLE leg whose container is a declared
 * 40ft box saved on the dispatch lane with no pair row ever created (QA
 * 01/11: lot 00048 saved). The DOC law is per-leg at assignment: a Kẹp
 * (DOUBLE) order's declared container must be a 20' shell. A container whose
 * size is not yet declared (no type link) keeps the "bổ sung sau" convention
 * and skips. Every dispatch-write path that stamps the classification/plate
 * calls this before its rig guards.
 */
export async function assertKepIssuingContainerClass(tx: Tx, args: {
  shipmentContainerId: number | null;
  classification: string | null | undefined;
}): Promise<void> {
  if (args.classification !== 'DOUBLE' || args.shipmentContainerId == null) return;
  const [container] = await tx.select({ code: s.containerTypes.code })
    .from(s.shipmentContainers)
    .leftJoin(s.containerTypes, eq(s.containerTypes.id, s.shipmentContainers.containerTypeId))
    .where(eq(s.shipmentContainers.id, args.shipmentContainerId))
    .limit(1);
  const foot = containerFootClass(container?.code ?? null);
  if (foot != null && foot !== '20') {
    throw new ApiError(409, KEP_CONTAINER_SIZE_BLOCK_MESSAGE);
  }
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
   * SIL-638 (id 742) TC6(2) — DOC logic-hang-kep-kethop: the kẹp 2×20'
   * weight-overload gate is a SOFT warning. The first attempt refuses with
   * 409 KEP_WEIGHT_WARNING (DOC verbatim text) and the dispatcher's
   * confirmed retry carries this flag to proceed — retiring the old hard
   * "Tổng trọng lượng hai container kẹp vượt quá tải trọng xe." 409 at all
   * three carve sites below.
   */
  kepWeightWarningConfirmed?: boolean;
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
    // TC6(2) — the partner's lot-level weight estimate: the trip-container
    // weight is copied from shipmentContainers at issue, so when the
    // container row carries none the lot declaration is the fallback.
    partnerShipmentWeight: s.shipments.cargoWeightKg,
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
      // SIL-666 round-2 — the issue gate obeys the trip-visibility law too:
      // a hidden lot's trip (canceled fulfillment / deleted or
      // non-operational lot) must not hard-block a new dispatch order with
      // "trùng lịch kế hoạch" (same defect class as the 31/12 plan-assign
      // phantom; the plan-row holders were purged by SIL-638 TC1 already).
      ...tripHolderVisibilitySql(),
      args.tripId != null ? ne(s.trips.id, args.tripId) : undefined,
      isNotNull(s.trips.plannedStartAt),
      lt(s.trips.plannedStartAt, args.plannedEndAt),
      sql`coalesce(${s.trips.plannedEndAt}, ${s.trips.plannedStartAt} + interval '8 hours') > ${args.plannedStartAt.toISOString()}::timestamptz`,
    ));

  let blocking = conflicts;
  // TC6(2) — whether a proven 20' co-rider already ran the weight guard (the
  // overlap carves below). When none did and the windows simply don't overlap,
  // the co-rider gate further down still runs: the clamp carries both boxes
  // simultaneously, so the capacity law follows the declared same-rig pair,
  // not the window overlap.
  let kepWeightGateRan = false;
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
  const declaredMode = declaredKepShareMode(kep);
  const shareRequest = {
    tripId: args.tripId,
    truckId: args.truckId,
    trailerId: args.trailerId,
    driverId: args.driverId,
    kep,
  };
  if (partner && isDeclaredKepSharePartner(shareRequest, partner, declaredMode)) {
    if (declaredMode === 'KEP') {
      const containers = await tx.select({ code: s.containerTypes.code, weight: s.tripContainers.cargoWeightKg })
        .from(s.tripContainers)
        .leftJoin(s.containerTypes, eq(s.containerTypes.id, s.tripContainers.containerTypeId))
        .where(eq(s.tripContainers.tripId, partner.id));
      if (containers.length === 1 && containers[0].code?.startsWith('20')) {
        // SIL-638 (id 742) TC6(2): DOC soft warning — refuse once with the
        // DOC verbatim text; the dispatcher's confirmed retry
        // (kepWeightWarningConfirmed) proceeds to save. The partner's weight
        // falls back to its lot declaration when the trip container row
        // carries none (QA 01/11: both legs read null and the gate went
        // silently unprovable).
        if (kepWeightGuardOutcome(
          kepPairWeightVerdict(
            args.cargoWeightKg,
            containers[0].weight ?? partner.partnerShipmentWeight,
            args.vehicleCapacityKg,
          ),
          args.kepWeightWarningConfirmed === true,
        ) === 'refuse') {
          throw new ApiError(409, KEP_WEIGHT_WARNING_MESSAGE, undefined, { code: KEP_WEIGHT_WARNING_CODE });
        }
        kepWeightGateRan = true;
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
  if (partner && isMixedDeclarationKepCandidate(shareRequest, partner)) {
    const containers = await tx.select({ code: s.containerTypes.code, weight: s.tripContainers.cargoWeightKg })
      .from(s.tripContainers)
      .leftJoin(s.containerTypes, eq(s.containerTypes.id, s.tripContainers.containerTypeId))
      .where(eq(s.tripContainers.tripId, partner.id));
    if (containers.length === 1 && containers[0].code?.startsWith('20')) {
      if (kepWeightGuardOutcome(
        kepPairWeightVerdict(
          args.cargoWeightKg,
          containers[0].weight ?? partner.partnerShipmentWeight,
          args.vehicleCapacityKg,
        ),
        args.kepWeightWarningConfirmed === true,
      ) === 'refuse') {
        throw new ApiError(409, KEP_WEIGHT_WARNING_MESSAGE, undefined, { code: KEP_WEIGHT_WARNING_CODE });
      }
      kepWeightGateRan = true;
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
        if (kepWeightGuardOutcome(
          kepPairWeightVerdict(
            args.cargoWeightKg,
            containers[0].weight ?? partner.partnerShipmentWeight,
            args.vehicleCapacityKg,
          ),
          args.kepWeightWarningConfirmed === true,
        ) === 'refuse') {
          throw new ApiError(409, KEP_WEIGHT_WARNING_MESSAGE, undefined, { code: KEP_WEIGHT_WARNING_CODE });
        }
        kepWeightGateRan = true;
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
  // SIL-638 (id 742) TC6(2) — the co-rider weight gate without window overlap.
  // The overlap carves above run the weight guard only when the two legs'
  // windows conflict, so QA's 28/12 pair (2×20' at 60,000 kg) saved with the
  // gate never evaluating. A declared clamp pair on ONE rig carries both boxes
  // simultaneously, so the capacity law follows the same-rig same-day declared
  // pair — the same law the MANUAL pairing gate pairs by (SIL-668: pairing is
  // a manual dispatch action, there is no automatic pairing scan) — not the
  // window overlap.
  // Runs only when the overlap scans found no blocking row (an overlapping
  // partner already ran the guard in the carves; a foreign overlap answers the
  // "trùng lịch" tier below). Confirmed retry (kepWeightWarningConfirmed)
  // proceeds; a third load or an already-paired partner stays outside.
  if (declaredMode === 'KEP' && !kepWeightGateRan && blocking.length === 0 && args.truckId != null) {
    const incomingDay = localDateInBusinessZone(args.plannedStartAt);
    const coRiderRows = await tx.select({
      id: s.trips.id,
      classification: s.shipmentFulfillments.dispatchClassification,
      truckId: s.trips.truckId,
      trailerId: s.trips.trailerId,
      driverId: s.trips.driverId,
      plannedStartAt: s.trips.plannedStartAt,
      shipmentId: s.shipmentFulfillments.shipmentId,
      partnerShipmentWeight: s.shipments.cargoWeightKg,
      activePairId: s.trips.activeTripPairId,
      pairFirstTripId: s.tripPairs.firstTripId,
      pairSecondTripId: s.tripPairs.secondTripId,
    }).from(s.trips)
      .leftJoin(s.shipmentFulfillments, eq(s.shipmentFulfillments.id, s.trips.fulfillmentId))
      .leftJoin(s.shipments, eq(s.shipments.id, s.shipmentFulfillments.shipmentId))
      .leftJoin(s.tripPairs, eq(s.tripPairs.id, s.trips.activeTripPairId))
      .where(and(
        eq(s.trips.truckId, args.truckId),
        isNull(s.trips.deletedAt),
        inArray(s.trips.status, [TripStatus.CREATED, TripStatus.IN_TRANSIT]),
        args.tripId != null ? ne(s.trips.id, args.tripId) : undefined,
        isNotNull(s.trips.plannedStartAt),
      ));
    const coRiders = coRiderRows
      .filter((row) => row.plannedStartAt != null
        && localDateInBusinessZone(row.plannedStartAt) === incomingDay)
      .filter((row) => isDeclaredKepSharePartner(shareRequest, row, 'KEP')
        || isMixedDeclarationKepCandidate(shareRequest, row))
      .sort((a, b) => a.id - b.id);
    for (const coRider of coRiders) {
      const containers = await tx.select({ code: s.containerTypes.code, weight: s.tripContainers.cargoWeightKg })
        .from(s.tripContainers)
        .leftJoin(s.containerTypes, eq(s.containerTypes.id, s.tripContainers.containerTypeId))
        .where(eq(s.tripContainers.tripId, coRider.id));
      if (!(containers.length === 1 && containers[0].code?.startsWith('20'))) continue;
      if (kepWeightGuardOutcome(
        kepPairWeightVerdict(
          args.cargoWeightKg,
          containers[0].weight ?? coRider.partnerShipmentWeight,
          args.vehicleCapacityKg,
        ),
        args.kepWeightWarningConfirmed === true,
      ) === 'refuse') {
        throw new ApiError(409, KEP_WEIGHT_WARNING_MESSAGE, undefined, { code: KEP_WEIGHT_WARNING_CODE });
      }
      break;
    }
  }
  if (blocking.some((row) => args.truckId != null && row.truckId === args.truckId)) {
    // SIL-638 (id 742) TC2 đợt 2 (QA 01/11) — the classification-mismatch
    // refusal answers BEFORE the generic "trùng lịch" copy: the holder on
    // this tractor is a DECLARED pair leg (Kẹp/Kết hợp) while the leg being
    // issued is a plain ĐƠN. The DOC's fix is the declaration, not the
    // schedule — the message names it ("Cần cả 2 cont cùng khai báo KẸP mới
    // cho đi chung xe"). Fires only on the TRUCK conflict (the "chung xe"
    // shape); trailer/driver-only conflicts keep the generic copy.
    const mismatchRow = blocking.find((row) =>
      args.truckId != null
      && row.truckId === args.truckId
      && classificationMismatchShareBlockMessage(kep?.classification ?? null, row.classification) != null);
    if (mismatchRow) {
      throw new ApiError(409, CLASSIFICATION_MISMATCH_SHARE_BLOCK_MESSAGE);
    }
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
    // SIL-638 TC2 — the reverse direction keeps its confirmable tier but
    // carries the DOC's wording (MIXED_DECLARATION_KEP_WARN_MESSAGE), not the
    // generic "đã được gán cho lô/tác vụ khác" copy.
    throw new ApiError(
      409,
      MIXED_DECLARATION_KEP_WARN_MESSAGE,
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
    // SIL-638 TC1 round 3 (QA 03/11 — "gate dropout persists"): the ISSUE path
    // had no busy-rig tier at all. The plan save warns on an IN_TRANSIT holder
    // (busyDayClaimOverlaps law, 02/11) but the Phát lệnh dialog issued
    // straight onto a rig that is literally out working — QA's 18:00 order
    // left the lot with a 201 while the ca-sáng leg ran IN_TRANSIT. Same DOC
    // message + confirmable contract, same whole-business-day claim. Carved
    // like the arrangements above: the issuing trip's own ACTIVE Kẹp pair
    // partner and its Ghép-trả-ĐV cost-group siblings are the deliberate
    // overlap, never a foreign busy claim (a same-lot leg stays in scope —
    // TC1's own repro is Cont A running while Cont C of the same lot tries to
    // claim the tractor).
    if (args.truckId != null) {
      const busyTrips = await tx.select({
        id: s.trips.id,
        plannedStartAt: s.trips.plannedStartAt,
        departureDate: s.trips.departureDate,
        plate: s.trucks.licensePlate,
        pairStatus: s.tripPairs.status,
        pairKind: s.tripPairs.pairKind,
        pairFirstTripId: s.tripPairs.firstTripId,
        pairSecondTripId: s.tripPairs.secondTripId,
        holderCostGroupId: s.shipments.costGroupId,
      }).from(s.trips)
        .innerJoin(s.trucks, eq(s.trucks.id, s.trips.truckId))
        .leftJoin(s.tripPairs, eq(s.tripPairs.id, s.trips.activeTripPairId))
        .leftJoin(s.shipmentFulfillments, eq(s.shipmentFulfillments.id, s.trips.fulfillmentId))
        .leftJoin(s.shipments, eq(s.shipments.id, s.shipmentFulfillments.shipmentId))
        .where(and(
          eq(s.trips.truckId, args.truckId),
          eq(s.trips.status, TripStatus.IN_TRANSIT),
          isNull(s.trips.deletedAt),
          args.tripId != null ? ne(s.trips.id, args.tripId) : undefined,
          or(
            sql`((${s.trips.plannedStartAt} at time zone 'Asia/Ho_Chi_Minh')::date) between ((${args.plannedStartAt.toISOString()}::timestamptz at time zone 'Asia/Ho_Chi_Minh')::date) and ((${args.plannedEndAt.toISOString()}::timestamptz at time zone 'Asia/Ho_Chi_Minh')::date)`,
            sql`((${s.trips.departureDate})::date) between ((${args.plannedStartAt.toISOString()}::timestamptz at time zone 'Asia/Ho_Chi_Minh')::date) and ((${args.plannedEndAt.toISOString()}::timestamptz at time zone 'Asia/Ho_Chi_Minh')::date)`,
          )!,
        ));
      const isOwnPairPartner = (trip: typeof busyTrips[number]) =>
        trip.pairStatus === 'ACTIVE' && trip.pairKind === 'KEP'
        && args.tripId != null
        && (trip.pairFirstTripId === args.tripId || trip.pairSecondTripId === args.tripId);
      const isCostGroupSibling = (trip: typeof busyTrips[number]) =>
        args.costGroupId != null && trip.holderCostGroupId != null
        && trip.holderCostGroupId === args.costGroupId;
      const foreignBusy = busyTrips.filter((trip) => !isOwnPairPartner(trip) && !isCostGroupSibling(trip));
      const busyOverlap = foreignBusy.some((trip) => {
        const holderStart = trip.plannedStartAt
          ?? (trip.departureDate ? new Date(`${trip.departureDate}T00:00:00+07:00`) : null);
        return holderStart != null && busyDayClaimOverlaps(holderStart, args.plannedStartAt, args.plannedEndAt);
      });
      if (busyOverlap) {
        throw new ApiError(409, busyRigWarnMessage(foreignBusy[0]?.plate ?? ''), undefined, { code: 'RIG_OVERLAP_COMPLETED' });
      }
    }
  }
}
