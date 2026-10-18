/**
 * Rig conflict-scan family for dispatch planning and the trip form (FB-038
 * family): plan-row holder scans (FCL + LCL branches), the plan-row window
 * resolution law, and assertTripRigAvailable — the trip-create/edit guard.
 * Extracted from dispatch-planning-detail-plan.service into a leaf so the
 * trip surfaces (trip-create, trip-figure-updates, trip-lifecycle-ops) can
 * share the guard without importing the detail-plan write module, which had
 * closed a 7-file runtime import cycle.
 */
import { and, eq, inArray, isNotNull, isNull, ne, notInArray, or, sql } from 'drizzle-orm';
import { localDateInBusinessZone, TripStatus, type DispatchClassification } from '@tingting/shared';
import * as s from '../db/schema';
import type { Tx } from '../db';
import { ApiError } from '../errors';
import { tripClaimEndSql, tripClaimStartSql } from './dispatch-resource-availability.service';
import { findActiveKepPairPartner } from './trip-pair-rig-sync.service';

/**
 * The window a plan row occupies its rig for. The slot follows the ONE law
 * every surface displays (`runAt`/`runHour`, `dispatchDetailRunMinutesSql`):
 * `coalesce(customerAppointmentAt, closingAt, plannedReturnAt)` — an FCL row
 * whose displayed slot rides the lot fallback is still a slot, never a
 * "no window" (card 101026043000: resolving FCL from the appointment alone
 * skipped the guard entirely and the double-booking saved silently). An LCL
 * lot has no container by design, so its window is the lot-level
 * closing/return date. `strong` marks the row's PRIMARY slot source: an
 * explicit container appointment (or the LCL lot date) proves the overlap;
 * a fallback slot is display evidence only — enough to WARN, never to guess
 * a hard block from (FB-038 ruling). Null means "no window to prove overlap
 * with", which callers treat as skip, never as a refusal.
 *
 * Case 2026-10-11-R14-04 (round 14, FB-038/072): the grid's date column
 * renders `coalesce(date(customerAppointmentAt), shipments.expectedDeliveryDate)`
 * (`dispatchDetailTransportDateSql`) — a lot-date-only row still DISPLAYS a
 * "Ngày giao" slot, and two such rows took the same truck at the same
 * displayed day with no warning at all. The displayed day is the
 * dispatcher's claim on the rig, so the window law gains that last fallback:
 * a date-only slot claims the whole displayed day (weak evidence → the WARN
 * tier, never a hard block).
 */
export interface PlanRowWindow {
  start: Date;
  /** The row's own default end: one 8-hour shift for a timestamped slot
   *  (card 363), the whole displayed day for a date-only slot. */
  end: Date;
  strong: boolean;
}

function expectedDeliveryDayStart(day: string | null): Date | null {
  if (!day) return null;
  // 'YYYY-MM-DD' date column → midnight Asia/Ho_Chi_Minh, the same instant the
  // display SQL (`date::timestamp at time zone 'Asia/Ho_Chi_Minh'`) claims.
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T00:00:00+07:00`) : null;
}

/** The identity facts both holder scans now carry (card B 18/10, B.4). */
export interface RigHolderFacts {
  shipmentId: number;
  costGroupId: string | null;
  shipmentCode: string | null;
  blNumber: string | null;
  bookingRef: string | null;
  slotAt: Date | null;
}

const viInstant = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/** "Lô BLCUSa29BD" / "Lô SHP-2610-01349" / "Lô #61959" — the reference the
 *  dispatcher reads in the grid, best available first. */
export function rigHolderLabel(holder: Pick<RigHolderFacts, 'shipmentId' | 'shipmentCode' | 'blNumber' | 'bookingRef'>): string {
  const ref = holder.shipmentCode?.trim() || holder.blNumber?.trim() || holder.bookingRef?.trim();
  return ref ? `Lô ${ref}` : `Lô #${holder.shipmentId}`;
}

/** The scan's slot coalesce mixes timestamptz columns with the day-claim
 *  expression; the driver may hand back a Date or a naive wall-time string.
 *  Naive strings are already Asia/Ho_Chi_Minh wall time (the SQL shifted
 *  them) — anchor them there, never in the server's zone. */
function asSlotDate(value: Date | string | null): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(text)) return null;
  const anchored = text.includes('+') || text.endsWith('Z')
    ? text.replace(' ', 'T')
    : `${text.replace(' ', 'T')}+07:00`;
  const parsed = new Date(anchored);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** The conflicting lots + their claimed slot, in the guard's message — the
 *  customer asked the refusal to name WHAT is holding the rig and WHEN
 *  ("đã gáp cho lô tác vụ khác trong khung giờ trùng"). */
export function describeRigHolders(holders: RigHolderFacts[]): string {
  return holders
    .map((holder) => {
      const slot = asSlotDate(holder.slotAt);
      return `${rigHolderLabel(holder)}${slot ? ` (từ ${viInstant.format(slot)})` : ''}`;
    })
    .join(', ');
}

/** The saving row's own cost group, for the Ghép-trả-ĐV sibling carve-out. */
export async function shipmentCostGroupId(tx: Tx, shipmentId: number | null | undefined): Promise<string | null> {
  if (shipmentId == null) return null;
  const [row] = await tx.select({ costGroupId: s.shipments.costGroupId })
    .from(s.shipments).where(eq(s.shipments.id, shipmentId)).limit(1);
  return row?.costGroupId ?? null;
}

export async function resolvePlanRowWindow(
  tx: Tx,
  fulfillment: { shipmentId: number; shipmentContainerId: number | null },
): Promise<PlanRowWindow | null> {
  if (fulfillment.shipmentContainerId != null) {
    const [row] = await tx.select({
      appointment: s.shipmentContainers.customerAppointmentAt,
      closingAt: s.shipments.closingAt,
      plannedReturnAt: s.shipments.plannedReturnAt,
      expectedDeliveryDate: s.shipments.expectedDeliveryDate,
    })
      .from(s.shipmentContainers)
      .innerJoin(s.shipments, eq(s.shipments.id, s.shipmentContainers.shipmentId))
      .where(eq(s.shipmentContainers.id, fulfillment.shipmentContainerId))
      .limit(1);
    const start = row?.appointment ?? row?.closingAt ?? row?.plannedReturnAt ?? null;
    if (start != null) {
      return { start, end: new Date(start.getTime() + 8 * 3600_000), strong: row?.appointment != null };
    }
    const dayStart = expectedDeliveryDayStart(row?.expectedDeliveryDate ?? null);
    return dayStart == null
      ? null
      : { start: dayStart, end: new Date(dayStart.getTime() + 24 * 3600_000), strong: false };
  }
  const [lot] = await tx.select({
    closingAt: s.shipments.closingAt,
    plannedReturnAt: s.shipments.plannedReturnAt,
    expectedDeliveryDate: s.shipments.expectedDeliveryDate,
  })
    .from(s.shipments)
    .where(eq(s.shipments.id, fulfillment.shipmentId))
    .limit(1);
  const start = lot?.closingAt ?? lot?.plannedReturnAt ?? null;
  // The lot date IS the LCL row's primary slot (card 061026174603) — full
  // evidence for an LCL row, unlike an FCL fallback.
  if (start != null) {
    return { start, end: new Date(start.getTime() + 8 * 3600_000), strong: true };
  }
  const dayStart = expectedDeliveryDayStart(lot?.expectedDeliveryDate ?? null);
  return dayStart == null
    ? null
    : { start: dayStart, end: new Date(dayStart.getTime() + 24 * 3600_000), strong: false };
}

/** Plan-row holders on a plate, FCL branch (container-linked rows).
 *  Law owner for the holder slot coalesce, shared by both rig guards:
 *  card 101026043000 (the grid's own slot coalesce, never appointment-only),
 *  card 363 (unsaved end ⇒ one 8-hour shift), case 2026-10-11-R14-04
 *  (date-only "Ngày giao" holder claims the whole displayed day — weak
 *  evidence). A fulfilled row whose trip COMPLETED has released the rig
 *  (061026172804): it must reach the completed tier's warning, never the
 *  generic plan-row block.
 *
 *  Card 171026121100 (FB-038/072 verify-fail 3): the container join was an
 *  INNER join, so a CONTAINER-LESS FCL row (the pre-decompose "fulfillment-
 *  less branch" shape staging reproduced: two rows of one lot, no container,
 *  date-only Ngày giao) was invisible as a holder — the same plate stacked
 *  onto row after row with no warning. A holder without a container claims
 *  the LOT window exactly like the LCL branch (061026174603 law: no container
 *  by design ⇒ the lot slot is the claim); its null appointment keeps the
 *  fallbackSlot marker, so the overlap stays weak evidence at the WARN tier.
 *
 *  Card 191026100010 (B.4): the holder's `shipments.costGroupId` rides the
 *  row so the guards can split cost-group siblings ("Gán xe nhóm" — one
 *  group = one truck by design) out of the cross-lot hard tier, exactly like
 *  FB-012 (181026145600) split same-lot holders. */
export async function scanPlanRowHolders(
  tx: Tx,
  plate: string,
  windowStart: Date,
  windowEnd: Date,
  excludeFulfillmentId: number,
) {
  const holderSlotSql = sql`coalesce(${s.shipmentContainers.customerAppointmentAt}, ${s.shipments.closingAt}, ${s.shipments.plannedReturnAt})`;
  const holderDaySql = sql`((${s.shipments.expectedDeliveryDate})::timestamp at time zone 'Asia/Ho_Chi_Minh')`;
  const holderStartSql = sql`coalesce(${holderSlotSql}, ${holderDaySql})`;
  const holderEndSql = sql`coalesce(${s.shipmentFulfillments.plannedEndAt}, case when ${holderSlotSql} is null then ${holderDaySql} + interval '1 day' else ${holderSlotSql} + interval '8 hours' end)`;
  return tx.select({
    id: s.shipmentFulfillments.id,
    shipmentId: s.shipmentFulfillments.shipmentId,
    // Card 191026100010 (B.4) — the cost-group sibling split's raw material.
    costGroupId: s.shipments.costGroupId,
    fallbackSlot: isNull(s.shipmentContainers.customerAppointmentAt),
    // Card B 18/10 (B.4): the guard's message must NAME the conflicting lot
    // and window, and same-COST-GROUP siblings must never read as cross-lot
    // claims — the group's shared truck is the arrangement itself.
    costGroupId: s.shipments.costGroupId,
    shipmentCode: s.shipments.shipmentCode,
    blNumber: s.shipments.blNumber,
    bookingRef: s.shipments.bookingRef,
    slotAt: sql<Date>`${holderStartSql}`,
  })
    .from(s.shipmentFulfillments)
    // Review M1 (card 171026121100): the left join admits container-less
    // rows, so the FCL branch must exclude LCL_SHIPMENT holders explicitly —
    // before the left join the inner container join excluded them implicitly,
    // and an LCL row here would always carry fallbackSlot=true (its joined
    // container columns are null), downgrading the LCL branch's
    // fully-evidenced cross-lot tier from hard block to warn. Container-less
    // FCL holders stay covered; a container-less holder claims the LOT window
    // and is weak evidence (warn tier) by design — the FB-038 ruling prefers
    // a warn over either a silent save or a new guessed hard block.
    .leftJoin(s.shipmentContainers, eq(s.shipmentContainers.id, s.shipmentFulfillments.shipmentContainerId))
    .innerJoin(s.shipments, eq(s.shipments.id, s.shipmentFulfillments.shipmentId))
    .where(and(
      ne(s.shipmentFulfillments.id, excludeFulfillmentId),
      ne(s.shipmentFulfillments.fulfillmentType, 'LCL_SHIPMENT'),
      isNull(s.shipmentFulfillments.canceledAt),
      eq(s.shipmentFulfillments.plannedVehiclePlateNumber, plate),
      sql`${holderStartSql} is not null`,
      sql`${holderStartSql} < ${windowEnd.toISOString()}::timestamptz`,
      sql`${holderEndSql} > ${windowStart.toISOString()}::timestamptz`,
      sql`not exists (select 1 from ${s.trips} where ${s.trips.fulfillmentId} = ${s.shipmentFulfillments.id} and ${s.trips.status} = 'COMPLETED' and ${s.trips.deletedAt} is null)`,
    ));
}

/** Plan-row holders on a plate, LCL branch (card 061026174603: Hàng lẻ rows
 *  are plan units with the LOT window). Same slot laws as the FCL branch;
 *  the fallbackSlot evidence marker keeps date-only holders at the warn tier
 *  (case 2026-10-11-R14-04 review B1). `costGroupId` rides the row for the
 *  card 191026100010 (B.4) cost-group sibling split — the branch where
 *  "Gán xe nhóm" actually lives. */
export async function scanLclPlanRowHolders(
  tx: Tx,
  plate: string,
  windowStart: Date,
  windowEnd: Date,
  excludeFulfillmentId: number,
) {
  const lclHolderSlotSql = sql`coalesce(${s.shipments.closingAt}, ${s.shipments.plannedReturnAt})`;
  const lclHolderDaySql = sql`((${s.shipments.expectedDeliveryDate})::timestamp at time zone 'Asia/Ho_Chi_Minh')`;
  const lclHolderStartSql = sql`coalesce(${lclHolderSlotSql}, ${lclHolderDaySql})`;
  const lclHolderEndSql = sql`coalesce(${s.shipmentFulfillments.plannedEndAt}, case when ${lclHolderSlotSql} is null then ${lclHolderDaySql} + interval '1 day' else ${lclHolderSlotSql} + interval '8 hours' end)`;
  return tx.select({
    id: s.shipmentFulfillments.id,
    shipmentId: s.shipmentFulfillments.shipmentId,
    // Card 191026100010 (B.4) — the cost-group sibling split's raw material.
    costGroupId: s.shipments.costGroupId,
    fallbackSlot: sql`(${lclHolderSlotSql}) is null`,
    // Card B 18/10 (B.4) — same identity/window facts as the FCL branch.
    costGroupId: s.shipments.costGroupId,
    shipmentCode: s.shipments.shipmentCode,
    blNumber: s.shipments.blNumber,
    bookingRef: s.shipments.bookingRef,
    slotAt: sql<Date>`${lclHolderStartSql}`,
  })
    .from(s.shipmentFulfillments)
    .innerJoin(s.shipments, eq(s.shipments.id, s.shipmentFulfillments.shipmentId))
    .where(and(
      ne(s.shipmentFulfillments.id, excludeFulfillmentId),
      isNull(s.shipmentFulfillments.canceledAt),
      eq(s.shipmentFulfillments.plannedVehiclePlateNumber, plate),
      eq(s.shipmentFulfillments.fulfillmentType, 'LCL_SHIPMENT'),
      sql`${lclHolderStartSql} is not null`,
      sql`${lclHolderStartSql} < ${windowEnd.toISOString()}::timestamptz`,
      sql`${lclHolderEndSql} > ${windowStart.toISOString()}::timestamptz`,
      sql`not exists (select 1 from ${s.trips} where ${s.trips.fulfillmentId} = ${s.shipmentFulfillments.id} and ${s.trips.status} = 'COMPLETED' and ${s.trips.deletedAt} is null)`,
    ));
}

/**
 * Ticket 111026105630 (FB-038 / FB-072 reopen): the trip edit form and the
 * direct trip create claim the rig exactly like the dispatch surfaces —
 * before this guard, PUT /trips/:id/pre-departure|actuals and POST /trips
 * landed truckId with no rig check and a same-window tractor double-booking
 * saved silently (round-14 staging repro: /trips/153 ← 15H-117.55 already on
 * /trips/160 the same day, toast 'Đã lưu thay đổi.').
 *
 * Same FB-038 family law as assertPlanRowRigAvailable, mirrored onto the
 * trip's own window: a plannedStartAt timestamp claims 8h or its staged end
 * (card 363) with FULL evidence; a date-only departure claims the displayed
 * day (12fcf20d law — weak evidence, warn tier). Holders: cross-lot plan rows
 * (hard when provable), the trip's own lot's rows (deliberate rotation —
 * warn), active trips (hard when both windows are provable), completed trips
 * (released the rig, card 363 — warn once). Never a silent save, never a
 * guessed hard block.
 */
export async function assertTripRigAvailable(
  tx: Tx,
  args: {
    /** The trip being saved (edit path): excluded from its own holder scans. */
    tripId?: number;
    truckId: number;
    /**
     * Round-17 sweep (overlap warning missing): the same DRIVER double-booked
     * across two DIFFERENT tractors saved silently on this path — the guard
     * scanned the tractor's plate only. Carried at the family's warn tier.
     */
    driverId?: number | null;
    departureDate: string;
    /** The saving trip's staged window; when plannedStartAt is absent the
     *  departure day claims the whole day (weak evidence). */
    plannedStartAt?: Date | null;
    plannedEndAt?: Date | null;
    /** The trip's origin fulfillment (edit path): its plan row holds the
     *  plate by design and is excluded; its classification carries the Kẹp
     *  carve-out (081026091100 — a DOUBLE pair shares the rig on purpose). */
    fulfillmentId?: number | null;
    /** Same-lot plan rows are the lot's own rotation (6051d39a) — warn, never
     *  the hard tier. */
    shipmentId?: number | null;
    confirmOverlap?: boolean;
  },
): Promise<void> {
  const [truck] = await tx.select({ licensePlate: s.trucks.licensePlate })
    .from(s.trucks).where(eq(s.trucks.id, args.truckId)).limit(1);
  const plate = (truck?.licensePlate ?? '').trim();
  if (!plate) return;

  // The saving trip's window: strong evidence only when a real timestamp
  // anchors it. plannedEndAt at/before the start is unprovable (the family's
  // degenerate-end law) — fall back to the window default, never a zero span.
  const windowStart = args.plannedStartAt
    ?? expectedDeliveryDayStart(args.departureDate);
  if (windowStart == null) return;
  const degenerateEnd = args.plannedEndAt != null && args.plannedEndAt.getTime() <= windowStart.getTime();
  const windowEnd = args.plannedEndAt != null && !degenerateEnd
    ? args.plannedEndAt
    : (args.plannedStartAt
        ? new Date(windowStart.getTime() + 8 * 3600_000)
        : new Date(windowStart.getTime() + 24 * 3600_000));
  const strong = args.plannedStartAt != null && !degenerateEnd;

  let classification: DispatchClassification | null = null;
  // Card 191026100010 (B.4): the saving trip's cost group, resolved through
  // its origin fulfillment → lot in the SAME read as the classification
  // (args.fulfillmentId → shipmentFulfillments.shipmentId →
  // shipments.costGroupId — read, never guessed). No fulfillment id ⇒ null
  // ⇒ no cost-group carve-out below (decision rule 5's safe default: every
  // holder keeps today's tier).
  let savingCostGroupId: string | null = null;
  if (args.fulfillmentId != null) {
    const [ff] = await tx.select({
      classification: s.shipmentFulfillments.dispatchClassification,
      costGroupId: s.shipments.costGroupId,
    })
      .from(s.shipmentFulfillments)
      .innerJoin(s.shipments, eq(s.shipments.id, s.shipmentFulfillments.shipmentId))
      .where(eq(s.shipmentFulfillments.id, args.fulfillmentId)).limit(1);
    classification = ff?.classification ?? null;
    savingCostGroupId = ff?.costGroupId ?? null;
  }
  const isKepPairing = classification === 'DOUBLE';

  // Card B 18/10 (B.4) — the Ghép-trả-ĐV carve-out key: the saving trip's lot
  // cost group, when the caller carries a shipment context.
  const ownCostGroupId = await shipmentCostGroupId(tx, args.shipmentId);
  const isSameGroup = (conflict: RigHolderFacts, ownGroupId: string | null): boolean =>
    ownGroupId != null && conflict.costGroupId != null && conflict.costGroupId === ownGroupId;

  const planConflicts = isKepPairing
    ? []
    : await scanPlanRowHolders(tx, plate, windowStart, windowEnd, args.fulfillmentId ?? -1);
  const lclPlanConflicts = isKepPairing
    ? []
    : await scanLclPlanRowHolders(tx, plate, windowStart, windowEnd, args.fulfillmentId ?? -1);

  // FB-081 v2 (card 181026003045): the other leg of the saving trip's OWN
  // ACTIVE Kẹp pair overlaps on this plate BY CONSTRUCTION (one mooc, one
  // truck, one driver — the pairing gate's own invariant). This fallback
  // guard had no carve-out at all, so a driver-only correction on one Kẹp
  // leg 409'd hard against its partner and the pair could never move a
  // driver; conversely a truck-only move to an empty plate never saw the
  // partner and split the pair silently. The reassign write now propagates
  // the rig to the partner leg in the same transaction
  // (propagateKepPairRigToPartner), so the partner's overlap is the
  // arrangement, not a conflict. Same-day claim only (the pair runs one
  // business day); KET_HOP pairs resolve null here per owner ruling Q4.
  let kepPartnerTripId: number | null = null;
  if (args.tripId != null) {
    const partner = await findActiveKepPairPartner(tx, args.tripId);
    const savingDay = args.plannedStartAt != null
      ? localDateInBusinessZone(args.plannedStartAt)
      : args.departureDate;
    if (partner != null && partner.partnerClaimDay != null && partner.partnerClaimDay === savingDay) {
      kepPartnerTripId = partner.partnerTripId;
    }
  }

  // Active dispatched trips on the same tractor. Mirrors the family's scan,
  // widened for the trip form's reality: a trip without a planned timestamp
  // still claims its departure day (12fcf20d) — those holders land at the
  // warn tier via the weak marker.
  const tripDaySql = sql`((${s.trips.departureDate})::timestamp at time zone 'Asia/Ho_Chi_Minh')`;
  const tripStartSql = sql`coalesce(${s.trips.plannedStartAt}, ${tripDaySql})`;
  const tripEndSql = sql`coalesce(${s.trips.plannedEndAt}, ${s.trips.plannedStartAt} + interval '8 hours', ${tripDaySql} + interval '1 day')`;
  const activeConflictsRaw = await tx.select({
    id: s.trips.id,
    weak: sql`${s.trips.plannedStartAt} is null`,
  })
    .from(s.trips)
    .innerJoin(s.trucks, eq(s.trucks.id, s.trips.truckId))
    .where(and(
      eq(s.trucks.licensePlate, plate),
      notInArray(s.trips.status, [TripStatus.CANCELED, TripStatus.COMPLETED]),
      isNull(s.trips.deletedAt),
      ...(args.tripId != null ? [ne(s.trips.id, args.tripId)] : []),
      sql`${tripStartSql} < ${windowEnd.toISOString()}::timestamptz`,
      sql`${tripEndSql} > ${windowStart.toISOString()}::timestamptz`,
    ));
  // The Kẹp partner carve-out above: the linked partner leg stops counting
  // as an active conflict (and must not degrade the evidence tier through
  // its own weak marker either — the pair's overlap is deliberate).
  const activeConflicts = kepPartnerTripId == null
    ? activeConflictsRaw
    : activeConflictsRaw.filter((conflict) => conflict.id !== kepPartnerTripId);

  // Card 191026100010 (B.4) — FB-012 (181026145600) widened to cost-group
  // siblings: "Gán xe nhóm" (FB-092) plans every member of ONE cost group
  // onto the SAME tractor on purpose, so a cross-lot plan-row holder sharing
  // a group id with the saving trip is the deliberate one-truck arrangement,
  // not a foreign claim — split it out of the cross-lot hard tier exactly
  // like the plan guard does. Two resolution routes, one rule (merge union):
  // card B 18/10's lot-cost-group route (ownCostGroupId) AND card
  // 191026100010's fulfillment route (savingCostGroupId) both carve;
  // same-group equality only (both sides non-null and equal; no resolvable
  // group ⇒ nothing carved), and a sibling's own slot never feeds
  // weakEvidence (rule 4: only NON-grouped cross-lot conflicts may move the
  // evidence tier).
  const isCostGroupSibling = (conflict: { shipmentId: number | null; costGroupId: string | null }) =>
    conflict.shipmentId !== args.shipmentId
    && savingCostGroupId != null
    && conflict.costGroupId != null
    && conflict.costGroupId === savingCostGroupId;
  const crossLotConflicts = planConflicts.filter((conflict) =>
    conflict.shipmentId !== args.shipmentId
    && !isSameGroup(conflict, ownCostGroupId)
    && !isCostGroupSibling(conflict));
  const crossLotLclConflicts = lclPlanConflicts.filter((conflict) =>
    conflict.shipmentId !== args.shipmentId
    && !isSameGroup(conflict, ownCostGroupId)
    && !isCostGroupSibling(conflict));
  const costGroupSiblingClaim = planConflicts.some(isCostGroupSibling)
    || lclPlanConflicts.some(isCostGroupSibling);
  const sameLotPlanClaim = planConflicts.length > 0 || lclPlanConflicts.length > 0;
  // Card B 18/10 (B.4): the saving trip's own Ghép-trả-ĐV group siblings —
  // the group's shared truck is the arrangement, so they ride the warn tier
  // with the lot's-own-rotation case, never the hard cross-lot tier.
  const groupSiblings = [...planConflicts, ...lclPlanConflicts]
    .filter((conflict) => conflict.shipmentId !== args.shipmentId && isSameGroup(conflict, ownCostGroupId));
  const planRowBlocked = crossLotConflicts.length > 0 || crossLotLclConflicts.length > 0;
  const weakEvidence = !strong
    || degenerateEnd
    || crossLotConflicts.some((conflict) => conflict.fallbackSlot)
    || crossLotLclConflicts.some((conflict) => conflict.fallbackSlot)
    || activeConflicts.some((conflict) => conflict.weak);

  if (planRowBlocked || activeConflicts.length > 0) {
    if (!weakEvidence) {
      // Card B 18/10 (B.4): the refusal names the conflicting lot(s) + window.
      throw new ApiError(409,
        `Đầu xe ${plate} đã được gán cho lô/tác vụ khác trong khung giờ trùng lặp: `
        + describeRigHolders([...crossLotConflicts, ...crossLotLclConflicts]) + '.');
    }
    if (!args.confirmOverlap) {
      throw new ApiError(409,
        `Đầu xe ${plate} đã được gán cho lô/tác vụ khác trong khung giờ trùng lặp: `
        + describeRigHolders([...crossLotConflicts, ...crossLotLclConflicts]) + '. Vẫn lưu?',
        undefined,
        { code: 'RIG_OVERLAP_COMPLETED' });
    }
  } else if (costGroupSiblingClaim && !args.confirmOverlap) {
    // Card 191026100010 (B.4) — decision rule 5: the trip form mirrors the
    // plan guard's split. The sibling lot holding this plate IS the group's
    // own one-truck plan ("Gán xe nhóm"): warn once with the cross-lot copy
    // + the confirm invitation, proceed on the confirmed retry — never
    // silent, never the hard tier. Kẹp rows cannot reach this branch (their
    // plan-row scans are emptied above by the pair's own carve-out).
    throw new ApiError(409,
      `Đầu xe ${plate} đã được gán cho lô/tác vụ khác trong khung giờ trùng lặp. Vẫn lưu?`,
      undefined,
      { code: 'RIG_OVERLAP_COMPLETED' });
  } else if (sameLotPlanClaim && !args.confirmOverlap) {
    throw new ApiError(409,
      groupSiblings.length > 0
        ? `Đầu xe ${plate} đang chạy cùng nhóm ghép trả ĐV với `
          + describeRigHolders(groupSiblings) + ' trong khung giờ trùng lặp. Vẫn lưu?'
        : `Đầu xe ${plate} đã được gán cho container khác của lô này trong khung giờ trùng lặp. Vẫn lưu?`,
      undefined,
      { code: 'RIG_OVERLAP_COMPLETED' });
  }
  if (!args.confirmOverlap) {
    // Third verify-fail (FB-038/072): a COMPLETED holder without a staged
    // start claims its departure day (shared claim window) — requiring
    // plannedStartAt hid ~94% of completed trips from this warn.
    const completedTripConflicts = await tx.select({ id: s.trips.id })
      .from(s.trips)
      .innerJoin(s.trucks, eq(s.trucks.id, s.trips.truckId))
      .where(and(
        eq(s.trucks.licensePlate, plate),
        eq(s.trips.status, TripStatus.COMPLETED),
        isNull(s.trips.deletedAt),
        ...(args.tripId != null ? [ne(s.trips.id, args.tripId)] : []),
        // Card 171026121100 (FB-038/072 verify-fail 3): a completed trip that
        // never carried staged timestamps still occupied its displayed day —
        // the old isNotNull(plannedStartAt) bar made it invisible. Rides the
        // shared tripClaim*Sql law owner (merged from trunk) — still warn-once,
        // never a block.
        sql`${tripClaimStartSql} < ${windowEnd.toISOString()}::timestamptz`,
        sql`${tripClaimEndSql} > ${windowStart.toISOString()}::timestamptz`,
      ));
    if (completedTripConflicts.length > 0) {
      throw new ApiError(409,
        `Đầu xe ${plate} có ${completedTripConflicts.length} chuyến đã hoàn thành trùng khung giờ phân công này. Vẫn lưu?`,
        undefined,
        { code: 'RIG_OVERLAP_COMPLETED' });
    }
  }
  // Round-17 sweep (overlap warning missing, P3): this guard scanned the
  // tractor's PLATE only, so the SAME driver double-booked across two
  // different tractors saved silently on the direct create/edit path (repro:
  // truck A + driver X at 08:45, then truck B + driver X the same window →
  // 201, no warning). FB-038 ruling: WARN, never a new hard block — the
  // same warn-once contract (RIG_OVERLAP_COMPLETED + confirmOverlap) carries
  // it, and the same window coalesce (an unset start claims the departure
  // day, a missing end one 8-hour shift) measures the driver's day exactly
  // like the holder scan above. A rig conflict has already thrown above, so
  // this branch fires for the cross-tractor case the plate scans cannot see.
  // Review harmonization: COMPLETED DRIVER holders still join only with a
  // provable window — a completed trip without a timestamp cannot prove the
  // driver was occupied (the family's "cannot prove overlap stays skipped"
  // law); drivers run multiple provable trips a day, and a legacy date-only
  // completed row must not nag every later save. The RIG scans above now
  // claim the displayed day for completed trips instead (card 171026121100):
  // the plate is a physical resource the grid shows parked on that day,
  // while a driver's occupancy of a date-only finished row stays unproven.
  if (args.driverId != null && !args.confirmOverlap) {
    const driverConflicts = await tx.select({ id: s.trips.id, code: s.trips.tripCode })
      .from(s.trips)
      .where(and(
        eq(s.trips.driverId, args.driverId),
        isNull(s.trips.deletedAt),
        ...(args.tripId != null ? [ne(s.trips.id, args.tripId)] : []),
        // FB-081 v2: the Kẹp partner shares the driver BY CONSTRUCTION —
        // warning about it is noise on every pair reassign.
        ...(kepPartnerTripId != null ? [ne(s.trips.id, kepPartnerTripId)] : []),
        or(
          inArray(s.trips.status, [TripStatus.CREATED, TripStatus.IN_TRANSIT]),
          and(eq(s.trips.status, TripStatus.COMPLETED), isNotNull(s.trips.plannedStartAt)),
        )!,
        sql`${tripStartSql} < ${windowEnd.toISOString()}::timestamptz`,
        sql`${tripEndSql} > ${windowStart.toISOString()}::timestamptz`,
      ));
    if (driverConflicts.length > 0) {
      throw new ApiError(409,
        `Tài xế đã có ${driverConflicts.length} chuyến khác trùng khung giờ phân công này. Vẫn lưu?`,
        undefined,
        { code: 'RIG_OVERLAP_COMPLETED' });
    }
  }
}
