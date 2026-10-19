/**
 * LCL lot grouping (FB-092/093, DEV SPEC Hàng lẻ §II.2.2–§II.3).
 *
 * One lô may share a physical truck with other lôs. Two independent money
 * dimensions group independently on `shipments`:
 *   COST — cước trả ĐV: dispatch assigns one truck to N lots ("Gán xe nhóm",
 *          FB-092). Lô 1 keeps 100% of the vendor freight; Lô 2..N's live
 *          trip external_freight_cost is zeroed.
 *   REV  — cước thu khách: CUS merges N same-customer lots into one bill
 *          (FB-093). Lô 1 keeps 100% of CƯỚC VẬN TẢI (AUTO-priced by the
 *          chosen vehicle class); Lô 2..N's live trip revenue is zeroed with
 *          the override reason "Ghép cước cùng Bill X".
 *
 * The promote-on-unmerge safety law (FB-095) lives here too: a principal
 * leaving its group (un-merge or soft delete) hands Lô-1 rights and 100% of
 * the money to the next member.
 */
import { and, asc, eq, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db, type Tx } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import { lclVehicleSourcingRule, LclVehicleSourcing } from '@tingting/shared';
import type {
  AssignLclCostGroupInput,
  LclGroupDimension,
  MergeLclRevGroupInput,
  SetLclLotRevClassInput,
  UnmergeLclLotInput,
  UnmergeLclGroupInput,
  UpdateLclTruckInput,
} from '@tingting/shared';
import { AuditEvent } from './audit-types';
import { persistAuditInTransaction } from './audit.service';
import { assertShipmentAccountingUnlocked } from './shipment-accounting-lock-reads.service';
import { upsertTripCarrierInfo, upsertTripFinancialState } from './trip-composite.service';
import { resolveCustomerVehicleClassPrice } from './pricing.service';
import { persistFreightRateSnapshot, type ResolvedFreightRate } from './freight-pricing-engine.service';

export interface LclGroupActor {
  userId: number;
  role: string;
  actorName?: string;
}

export interface LclGroupMemberResult {
  shipmentId: number;
  order: number;
  /** Số Bill / Số Booking — display key, never the internal id. */
  reference: string;
}

export interface LclGroupAssignResult {
  groupId: string;
  memberCount: number;
  members: LclGroupMemberResult[];
}

/** FB-095 — one lot's exit from a group dimension. */
export interface LclGroupUnmergeResult {
  dimension: LclGroupDimension;
  groupId: string;
  leaver: LclGroupMemberResult;
  /** The member that inherited Lô-1 rights + 100% money (null when the
   *  leaver was a member, or the group dissolved with no promotion). */
  promoted: LclGroupMemberResult | null;
  /** Money moved from the leaver to the promotee ('0' when none moved). */
  transferredAmount: string | null;
  /** 161026232329 — the driver road money that followed the crown ('null'
   *  when the leaver held none, or the group is not the internal fleet's). */
  transferredDriverMoney: { driverSalary: string; totalRoadAllowance: string } | null;
  /** Surviving members after renumbering (empty ⇒ the group dissolved). */
  remaining: LclGroupMemberResult[];
  dissolved: boolean;
}

/**
 * 161026232349 (§II.3.2 "Thu riêng từng lô") — one ungrouped lot's thu class
 * change: the class stamp plus the channel the resolved AUTO cước thu landed
 * on. `freightAuto` is null (never 0) when the customer × route × class lane
 * holds no price row — the class still saves so CUS can fix the price later.
 */
export interface LclSingleLotRevClassResult {
  shipmentId: number;
  reference: string;
  vehicleSizeClassId: number;
  /** vehicle_size_classes.code, e.g. '5T' / 'CONT20'. */
  vehicleClassCode: string;
  /** 100% of the chosen class' lane price (VND); null = Chưa xác định. */
  freightAuto: string | null;
  /** TRIP = the lot's live trip carries the override stamp; SNAPSHOT = the
   *  lot has no live trip and the money materialized at the merge path's
   *  shipment-level grain; NONE = no lane price ⇒ nothing written. */
  channel: 'TRIP' | 'SNAPSHOT' | 'NONE';
  /** The override reason / snapshot formula note; null on a lane miss. */
  reason: string | null;
}
/** Full group un-merge / dissolve result. */
export interface LclGroupDissolveResult {
  dimension: LclGroupDimension;
  groupId: string;
  memberCount: number;
  members: LclGroupMemberResult[];
  dissolved: true;
}

export type ShipmentRow = typeof s.shipments.$inferSelect;
/** Live-trip facts the money steps need, keyed by shipmentId. */
export interface LiveTripFacts {
  tripId: number;
  status: string;
  departureDate: string;
  carrierType: string | null;
  externalFreightCost: string | null;
  revenue: string | null;
  revenueOriginal: string | null;
  /** 161026232329 — the driver's road money ("lương chuyến" + "tiền đường"),
   *  the two stored columns every salary surface sums. */
  driverSalary: string | null;
  totalRoadAllowance: string | null;
}

async function loadLiveTripFactsByShipment(
  tx: Tx,
  shipmentIds: number[],
): Promise<Map<number, LiveTripFacts>> {
  const facts = new Map<number, LiveTripFacts>();
  if (shipmentIds.length === 0) return facts;
  // Complete live-trip form (direct link + via fulfillment), mirroring the
  // softDeleteShipment guard: `isNull(deletedAt)` + status <> CANCELED.
  const rows = await tx.select({
    shipmentId: s.trips.shipmentId,
    fulfillmentShipmentId: s.shipmentFulfillments.shipmentId,
    tripId: s.trips.id,
    status: s.trips.status,
    departureDate: s.trips.departureDate,
    carrierType: s.tripCarrierInfo.carrierType,
    externalFreightCost: s.tripCarrierInfo.externalFreightCost,
    revenue: s.tripFinancialState.revenue,
    revenueOriginal: s.tripFinancialState.revenueOriginal,
    driverSalary: s.tripFinancialState.driverSalary,
    totalRoadAllowance: s.tripFinancialState.totalRoadAllowance,
  }).from(s.trips)
    .leftJoin(s.shipmentFulfillments, eq(s.trips.fulfillmentId, s.shipmentFulfillments.id))
    .leftJoin(s.tripCarrierInfo, eq(s.tripCarrierInfo.tripId, s.trips.id))
    .leftJoin(s.tripFinancialState, eq(s.tripFinancialState.tripId, s.trips.id))
    .where(and(
      isNull(s.trips.deletedAt),
      ne(s.trips.status, 'CANCELED'),
      or(
        inArray(s.trips.shipmentId, shipmentIds),
        inArray(s.shipmentFulfillments.shipmentId, shipmentIds),
      )!,
    ));
  for (const row of rows) {
    const owner = row.shipmentId ?? row.fulfillmentShipmentId;
    if (owner == null || !shipmentIds.includes(owner)) continue;
    // One live trip per dispatch unit is DB-enforced; first hit wins.
    if (!facts.has(owner)) {
      facts.set(owner, {
        tripId: row.tripId,
        status: row.status ?? 'CREATED',
        departureDate: row.departureDate,
        carrierType: row.carrierType,
        externalFreightCost: row.externalFreightCost,
        revenue: row.revenue,
        revenueOriginal: row.revenueOriginal,
        driverSalary: row.driverSalary,
        totalRoadAllowance: row.totalRoadAllowance,
      });
    }
  }
  return facts;
}

/** Lock + load the given shipments inside a transaction (id order = no deadlock). */
async function lockShipments(tx: Tx, shipmentIds: number[]): Promise<ShipmentRow[]> {
  const ordered = [...shipmentIds].sort((a, b) => a - b);
  return tx.select().from(s.shipments)
    .where(and(inArray(s.shipments.id, ordered), isNull(s.shipments.deletedAt)))
    .for('update');
}

/** Số Bill / Số Booking of a lot — the display key, with code fallback. */
function lotReference(shipment: ShipmentRow): string {
  return shipment.blNumber ?? shipment.bookingRef ?? shipment.shipmentCode ?? `Lô #${shipment.id}`;
}

/** Every selected lot must be a live LCL lot not already grouped in this dimension. */
function assertGroupable(rows: ShipmentRow[], shipmentIds: number[], dimension: LclGroupDimension): void {
  if (rows.length !== shipmentIds.length) {
    throw new ApiError(404, 'Có lô không tồn tại hoặc đã bị xóa trong danh sách ghép');
  }
  for (const row of rows) {
    if (row.cargoMode !== 'LCL') {
      throw new ApiError(400, `Lô ${lotReference(row)} không phải hàng lẻ — chỉ gom được các lô LCL`);
    }
    const groupId = dimension === 'COST' ? row.costGroupId : row.revGroupId;
    if (groupId != null) {
      throw new ApiError(409, `Lô ${lotReference(row)} đã thuộc nhóm ghép — tách khỏi nhóm trước khi gom lại`);
    }
  }
}

async function assertMergeableMoney(tx: Tx, rows: ShipmentRow[], tripFacts: Map<number, LiveTripFacts>): Promise<void> {
  for (const row of rows) {
    await assertShipmentAccountingUnlocked(tx, row.id);
    const trip = tripFacts.get(row.id);
    if (trip && trip.status === 'COMPLETED') {
      throw new ApiError(409, `Lô ${lotReference(row)} đã hoàn thành chuyến — không thay đổi nhóm ghép được nữa`);
    }
  }
}

// ─── FB-095 — un-merge safety (DEV SPEC §II.4) ──────────────────────────────

/** The group column pair of one money dimension. */
function dimensionGroupOf(row: ShipmentRow, dimension: LclGroupDimension): { groupId: string | null; order: number | null } {
  return dimension === 'COST'
    ? { groupId: row.costGroupId, order: row.costGroupOrder }
    : { groupId: row.revGroupId, order: row.revGroupOrder };
}

/**
 * FB-095 guard — a settled (accounting-locked) group is frozen: any member
 * carrying an active lock blocks every composition change of the whole group,
 * because the issued debit note priced that composition. Completed trips
 * freeze the group for the same reason the merge commands do.
 */
async function assertGroupMutable(
  tx: Tx,
  members: ShipmentRow[],
  tripFacts: Map<number, LiveTripFacts>,
): Promise<void> {
  for (const member of [...members].sort((a, b) => a.id - b.id)) {
    try {
      await assertShipmentAccountingUnlocked(tx, member.id);
    } catch {
      throw new ApiError(
        409,
        `Nhóm ghép đã chốt kế toán — Lô ${lotReference(member)} đang khóa sổ, không thể tách nhóm`,
      );
    }
  }
  await assertMergeableMoney(tx, members, tripFacts);
}

/** Lock + load the live members of one group dimension, ordered by group order. */
async function lockGroupMembers(tx: Tx, dimension: LclGroupDimension, groupId: string): Promise<ShipmentRow[]> {
  const rows = await tx.select().from(s.shipments)
    .where(and(
      dimension === 'COST' ? eq(s.shipments.costGroupId, groupId) : eq(s.shipments.revGroupId, groupId),
      isNull(s.shipments.deletedAt),
    ))
    .orderBy(asc(s.shipments.id))
    .for('update');
  return rows.sort((a, b) =>
    (dimensionGroupOf(a, dimension).order ?? Number.MAX_SAFE_INTEGER)
    - (dimensionGroupOf(b, dimension).order ?? Number.MAX_SAFE_INTEGER)
    || a.id - b.id);
}

/**
 * The LEAVER's patch — the lot that exits a group: membership AND the
 * dimension's class stamp go (BKS facts stay), so the leaver is fully
 * ungrouped and unpriced until it groups again.
 */
function clearLeaverDimensionPatch(dimension: LclGroupDimension): Partial<typeof s.shipments.$inferInsert> {
  return dimension === 'COST'
    ? { costGroupId: null, costGroupOrder: null, costVehicleClassId: null }
    : { revGroupId: null, revGroupOrder: null, revVehicleClassId: null };
}

/**
 * The DISSOLVE patch — a lone survivor is not a group: only the membership
 * fields go, so it can group again later. Its class + BKS + money stay
 * (FB-095 law; QA C-1 — clearing the class here stripped the dispatch and
 * accounting boards, and the Debit Note, of the survivor's loại xe).
 */
function dissolveGroupMembershipPatch(dimension: LclGroupDimension): Partial<typeof s.shipments.$inferInsert> {
  return dimension === 'COST'
    ? { costGroupId: null, costGroupOrder: null }
    : { revGroupId: null, revGroupOrder: null };
}

/** Write the renumbered survivor rows (a lone survivor dissolves the group). */
async function rewriteSurvivors(
  tx: Tx,
  dimension: LclGroupDimension,
  survivors: ShipmentRow[],
  groupId: string,
  actor: LclGroupActor,
): Promise<void> {
  const dissolved = survivors.length === 1;
  for (const [index, survivor] of survivors.entries()) {
    const patch: Partial<typeof s.shipments.$inferInsert> = {
      updatedBy: actor.userId,
      updatedAt: new Date(),
      version: survivor.version + 1,
    };
    if (dissolved) {
      // One member is not a group: the survivor keeps its class + BKS + money
      // but leaves the group id so it can group again later.
      Object.assign(patch, dissolveGroupMembershipPatch(dimension));
    } else if (dimension === 'COST') {
      patch.costGroupId = groupId;
      patch.costGroupOrder = index + 1;
    } else {
      patch.revGroupId = groupId;
      patch.revGroupOrder = index + 1;
    }
    await tx.update(s.shipments).set(patch).where(eq(s.shipments.id, survivor.id));
  }
}

/**
 * FB-095 promote-on-removal engine, shared by un-merge and principal
 * deletion. The leaving row must already be locked and be order 1 of its
 * group in the given dimension. Moves 100% of the group's money to the next
 * live member — the freight must never fall to 0₫ because Lô 1 left.
 */
async function promotePrincipalOnRemoval(
  tx: Tx,
  dimension: LclGroupDimension,
  groupId: string,
  leaver: ShipmentRow,
  orderedMembers: ShipmentRow[],
  tripFacts: Map<number, LiveTripFacts>,
  actor: LclGroupActor,
): Promise<{
  promoted: LclGroupMemberResult | null;
  transferredAmount: string | null;
  /** 161026232329 — the driver road money that followed the crown. */
  transferredDriverMoney: { driverSalary: string; totalRoadAllowance: string } | null;
}> {
  const survivors = orderedMembers.filter((member) => member.id !== leaver.id);
  if (survivors.length === 0) {
    return { promoted: null, transferredAmount: null, transferredDriverMoney: null };
  }
  const promotee = survivors[0]!;
  const leaverTrip = tripFacts.get(leaver.id) ?? null;
  const promoteeTrip = tripFacts.get(promotee.id) ?? null;
  let transferredAmount: string | null = null;
  let transferredDriverMoney: { driverSalary: string; totalRoadAllowance: string } | null = null;

  if (dimension === 'COST') {
    const freight = leaverTrip?.externalFreightCost ?? null;
    if (freight != null && Number(freight) !== 0) {
      if (promoteeTrip == null) {
        throw new ApiError(
          409,
          `Lô ${lotReference(promotee)} chưa có chuyến live để giữ cước trả ĐV — không thể tách Lô 1 khỏi nhóm`,
        );
      }
      await upsertTripCarrierInfo(tx, promoteeTrip.tripId, { externalFreightCost: freight });
      if (leaverTrip) {
        await upsertTripCarrierInfo(tx, leaverTrip.tripId, { externalFreightCost: '0' });
      }
      transferredAmount = freight;
    }

    // 161026232329 — the driver's road money (lương chuyến + tiền đường) is
    // counted ONCE for an internal-fleet group, so it is Lô-1 money like the
    // freight: leaving the crown hands it to the survivor, never to 0₫. The
    // road allowance is pinned through road_allowance_override so a later
    // "lưu số liệu" cannot re-derive it away from the survivor.
    const salary = leaverTrip?.driverSalary ?? null;
    const roadAllowance = leaverTrip?.totalRoadAllowance ?? null;
    const carriesDriverMoney = leaverTrip != null
      && leaverTrip.carrierType === 'OWN'
      && ((salary != null && Number(salary) !== 0) || (roadAllowance != null && Number(roadAllowance) !== 0));
    if (carriesDriverMoney) {
      if (promoteeTrip == null) {
        throw new ApiError(
          409,
          `Lô ${lotReference(promotee)} chưa có chuyến live để giữ cước trả ĐV — không thể tách Lô 1 khỏi nhóm`,
        );
      }
      await upsertTripFinancialState(tx, promoteeTrip.tripId, {
        driverSalary: salary ?? '0',
        totalRoadAllowance: roadAllowance ?? '0',
        ...(roadAllowance != null ? { roadAllowanceOverride: roadAllowance } : {}),
      });
      await upsertTripFinancialState(tx, leaverTrip.tripId, {
        driverSalary: '0',
        totalRoadAllowance: '0',
        roadAllowanceOverride: '0',
      });
      transferredDriverMoney = { driverSalary: salary ?? '0', totalRoadAllowance: roadAllowance ?? '0' };
    }
  } else {
    // 161026204709 follow-through: the merge may have materialized the money
    // as a shipment-level snapshot on lots that still have no trip, so the
    // FB-095 transfer reads/writes BOTH channels — trip revenue first, the
    // trip-less snapshot as the fallback grain.
    const revenue = leaverTrip?.revenue != null && Number(leaverTrip.revenue) !== 0
      ? leaverTrip.revenue
      : await latestShipmentLevelSnapshotAmount(tx, leaver.id);
    if (revenue != null && Number(revenue) !== 0) {
      // Card law: a computed financial zero is a value — cite its reason. The
      // promotee sheds its member-zero stamp and inherits the principal money.
      if (promoteeTrip != null) {
        await upsertTripFinancialState(tx, promoteeTrip.tripId, {
          revenue: String(revenue),
          revenueOverriddenBy: actor.userId,
          revenueOverriddenAt: new Date(),
          revenueOverrideReason: `Đón cước chính khi tách nhóm (từ Bill ${lotReference(leaver)})`,
        });
      }
      await insertRevMergeSnapshot(
        tx,
        promotee.id,
        Number(revenue),
        `Đón cước chính khi tách nhóm (từ Bill ${lotReference(leaver)}) — 100% cước thu`,
      );
      if (leaverTrip != null) {
        await upsertTripFinancialState(tx, leaverTrip.tripId, {
          revenue: '0',
          revenueOriginal: String(revenue),
          revenueOverriddenBy: actor.userId,
          revenueOverriddenAt: new Date(),
          revenueOverrideReason: `Tách nhóm — chuyển 100% cước cho Bill ${lotReference(promotee)}`,
        });
      } else {
        await insertRevMergeSnapshot(
          tx,
          leaver.id,
          0,
          `Tách nhóm — chuyển 100% cước cho Bill ${lotReference(promotee)}`,
        );
      }
      transferredAmount = String(revenue);
    }
  }

  await rewriteSurvivors(tx, dimension, survivors, groupId, actor);
  return {
    promoted: { shipmentId: promotee.id, order: 1, reference: lotReference(promotee) },
    transferredAmount,
    transferredDriverMoney,
  };
}

/**
 * Un-merge / dissolve an entire LCL group in one atomic transaction.
 * All members are ungrouped; the primary member keeps 100% of the money
 * (and vehicle class), while other members stay at 0₫ awaiting re-pricing,
 * so the total group freight is strictly conserved.
 */
export async function unmergeLclGroup(
  input: UnmergeLclGroupInput,
  actor: LclGroupActor,
): Promise<LclGroupDissolveResult> {
  return db.transaction(async (tx) => {
    const ordered = await lockGroupMembers(tx, input.dimension, input.groupId);
    if (ordered.length === 0) {
      throw new ApiError(404, 'Không tìm thấy nhóm ghép');
    }
    const tripFacts = await loadLiveTripFactsByShipment(tx, ordered.map((row) => row.id));
    await assertGroupMutable(tx, ordered, tripFacts);

    for (const member of ordered) {
      await tx.update(s.shipments).set({
        ...dissolveGroupMembershipPatch(input.dimension),
        version: member.version + 1,
        updatedBy: actor.userId,
        updatedAt: new Date(),
      }).where(eq(s.shipments.id, member.id));

      const { order } = dimensionGroupOf(member, input.dimension);
      if (order !== 1 && input.dimension === 'REV') {
        const trip = tripFacts.get(member.id);
        if (trip && trip.revenue === '0') {
          await upsertTripFinancialState(tx, trip.tripId, {
            revenueOverriddenBy: actor.userId,
            revenueOverriddenAt: new Date(),
            revenueOverrideReason: 'Tách khỏi nhóm ghép — chờ định giá lại',
          });
        }
        if (!trip) {
          const snapshotAmount = await latestShipmentLevelSnapshotAmount(tx, member.id);
          if (snapshotAmount === 0) {
            await insertRevMergeSnapshot(tx, member.id, 0, 'Tách khỏi nhóm ghép — chờ định giá lại');
          }
        }
      }
    }

    await auditGroupChange(tx, actor, AuditEvent.SHIPMENT_LCL_GROUP_UNMERGED, ordered[0]!, {
      dimension: input.dimension,
      groupId: input.groupId,
      cause: 'UNMERGE_GROUP',
      dissolved: true,
      memberCount: ordered.length,
      members: ordered.map((row, idx) => ({ shipmentId: row.id, order: idx + 1, reference: lotReference(row) })),
    });

    return {
      dimension: input.dimension,
      groupId: input.groupId,
      memberCount: ordered.length,
      members: ordered.map((row, idx) => ({ shipmentId: row.id, order: idx + 1, reference: lotReference(row) })),
      dissolved: true,
    };
  });
}

/**
 * FB-095 — a lot leaves one money dimension's group.
 *
 * Laws (kanban FB-095):
 *   - settled group ⇒ refused (an active accounting lock on ANY member);
 *   - leaving Lô 1 auto-promotes the next member with 100% of the money —
 *     the group's freight never falls to 0₫;
 *   - a member leaving keeps its 0₫ awaiting re-pricing (re-stamped REV
 *     reason — the "Ghép cùng Bill X" stamp would be stale); the survivors
 *     are renumbered, or the group dissolves when one member remains (QA C-2 —
 *     the response/audit must report the DB post-state, never a ghost group);
 *   - both dimensions apply independently; audit rides every exit.
 */
export async function unmergeLclLot(
  input: UnmergeLclLotInput,
  actor: LclGroupActor,
): Promise<LclGroupUnmergeResult> {
  return db.transaction(async (tx) => {
    const [leaver] = await tx.select().from(s.shipments)
      .where(and(eq(s.shipments.id, input.shipmentId), isNull(s.shipments.deletedAt)))
      .for('update');
    if (!leaver) throw new ApiError(404, 'Không tìm thấy lô hàng');
    if (leaver.cargoMode !== 'LCL') {
      throw new ApiError(400, `Lô ${lotReference(leaver)} không phải hàng lẻ — không thuộc nhóm ghép`);
    }
    const { groupId, order: leaverOrder } = dimensionGroupOf(leaver, input.dimension);
    if (groupId == null) {
      throw new ApiError(400, `Lô ${lotReference(leaver)} không thuộc nhóm ghép nào ở chiều này — không có gì để tách`);
    }

    const ordered = await lockGroupMembers(tx, input.dimension, groupId);
    const tripFacts = await loadLiveTripFactsByShipment(tx, ordered.map((row) => row.id));
    await assertGroupMutable(tx, ordered, tripFacts);

    const survivors = ordered.filter((row) => row.id !== leaver.id);
    const { promoted, transferredAmount, transferredDriverMoney } = leaverOrder === 1
      ? await promotePrincipalOnRemoval(tx, input.dimension, groupId, leaver, ordered, tripFacts, actor)
      : { promoted: null, transferredAmount: null, transferredDriverMoney: null };

    // QA C-2 — a member's exit must rewrite the survivors too: renumber the
    // rest under the same group, or dissolve it when one member remains.
    // Skipping this left a ghost group id (409 on re-merge) and order gaps,
    // while the response/audit below claimed a renumber the DB never got.
    // No money moves here — only the principal's exit transfers money.
    if (leaverOrder !== 1) {
      await rewriteSurvivors(tx, input.dimension, survivors, groupId, actor);
    }

    // The leaver leaves: dimension fields cleared, version bumped. A member
    // whose REV zero cites the dead group gets a current reason instead.
    await tx.update(s.shipments).set({
      ...clearLeaverDimensionPatch(input.dimension),
      version: leaver.version + 1,
      updatedBy: actor.userId,
      updatedAt: new Date(),
    }).where(eq(s.shipments.id, leaver.id));
    if (leaverOrder !== 1 && input.dimension === 'REV') {
      const trip = tripFacts.get(leaver.id);
      if (trip && trip.revenue === '0') {
        await upsertTripFinancialState(tx, trip.tripId, {
          revenueOverriddenBy: actor.userId,
          revenueOverriddenAt: new Date(),
          revenueOverrideReason: 'Tách khỏi nhóm ghép — chờ định giá lại',
        });
      }
      if (!trip) {
        // 161026204709: a trip-less member leaving carries its cited merge
        // zero as a shipment snapshot — re-cite it as stale-priced on exit.
        const snapshotAmount = await latestShipmentLevelSnapshotAmount(tx, leaver.id);
        if (snapshotAmount === 0) {
          await insertRevMergeSnapshot(tx, leaver.id, 0, 'Tách khỏi nhóm ghép — chờ định giá lại');
        }
      }
    }

    // A lone survivor is not a "remaining group": it was promoted and now
    // stands alone (the group dissolved), so it leaves the member list.
    const dissolved = survivors.length <= 1;
    const remaining = dissolved ? [] : survivors.map((row, index) => ({
      shipmentId: row.id,
      order: index + 1,
      reference: lotReference(row),
    }));
    await auditGroupChange(tx, actor, AuditEvent.SHIPMENT_LCL_GROUP_UNMERGED, leaver, {
      dimension: input.dimension,
      groupId,
      cause: 'UNMERGE',
      leaver: { shipmentId: leaver.id, order: leaverOrder ?? 0, reference: lotReference(leaver) },
      promoted: promoted == null ? null : { shipmentId: promoted.shipmentId, reference: promoted.reference },
      transferredAmount,
      transferredDriverMoney,
      remaining,
      dissolved,
    });

    return {
      dimension: input.dimension,
      groupId,
      leaver: { shipmentId: leaver.id, order: leaverOrder ?? 0, reference: lotReference(leaver) },
      promoted,
      transferredAmount,
      transferredDriverMoney,
      remaining,
      dissolved,
    };
  });
}

/**
 * FB-095 — soft-delete hook: deleting a group principal must hand the crown
 * to the next member inside the same transaction. The delete boundary already
 * guarantees the leaver has no live trip, so no money can sit on it — but the
 * survivors must never point at a headless group. Settled/completed members
 * block the delete for the same reason they block un-merge.
 */
export async function promoteLclGroupsOnShipmentDelete(
  tx: Tx,
  leaver: ShipmentRow,
  actor: LclGroupActor,
): Promise<void> {
  for (const dimension of ['COST', 'REV'] as const) {
    const { groupId, order } = dimensionGroupOf(leaver, dimension);
    if (groupId == null) continue;
    const ordered = await lockGroupMembers(tx, dimension, groupId);
    const survivors = ordered.filter((row) => row.id !== leaver.id);
    if (survivors.length === 0) continue;
    const tripFacts = await loadLiveTripFactsByShipment(tx, ordered.map((row) => row.id));
    await assertGroupMutable(tx, ordered, tripFacts);

    if (order === 1) {
      const { promoted, transferredAmount, transferredDriverMoney } = await promotePrincipalOnRemoval(
        tx,
        dimension,
        groupId,
        leaver,
        ordered,
        tripFacts,
        actor,
      );
      const dissolved = survivors.length === 1;
      await auditGroupChange(tx, actor, AuditEvent.SHIPMENT_LCL_GROUP_UNMERGED, leaver, {
        dimension,
        groupId,
        cause: 'DELETE',
        leaver: { shipmentId: leaver.id, order: order ?? 1, reference: lotReference(leaver) },
        promoted: promoted == null ? null : { shipmentId: promoted.shipmentId, reference: promoted.reference },
        transferredAmount,
        transferredDriverMoney,
        remaining: dissolved ? [] : survivors.map((row, index) => ({ shipmentId: row.id, order: index + 1, reference: lotReference(row) })),
        dissolved,
      });
    } else {
      // Member (order > 1) deleted. Survivors renumbered, or dissolved if only 1 member remains.
      await rewriteSurvivors(tx, dimension, survivors, groupId, actor);
      const dissolved = survivors.length === 1;
      await auditGroupChange(tx, actor, AuditEvent.SHIPMENT_LCL_GROUP_UNMERGED, leaver, {
        dimension,
        groupId,
        cause: 'DELETE',
        leaver: { shipmentId: leaver.id, order: order ?? 0, reference: lotReference(leaver) },
        promoted: null,
        transferredAmount: null,
        transferredDriverMoney: null,
        remaining: dissolved ? [] : survivors.map((row, index) => ({ shipmentId: row.id, order: index + 1, reference: lotReference(row) })),
        dissolved,
      });
    }
  }
}

async function loadVehicleClass(tx: Tx, vehicleSizeClassId: number) {
  const [vehicleClass] = await tx.select().from(s.vehicleSizeClasses)
    .where(and(eq(s.vehicleSizeClasses.id, vehicleSizeClassId), isNull(s.vehicleSizeClasses.deletedAt)))
    .limit(1);
  if (!vehicleClass) {
    throw new ApiError(404, 'Loại xe tính cước không tồn tại trong danh mục');
  }
  return vehicleClass;
}

/**
 * 161026204709 (TC-A12) — the REV merge promise ("Lô 1 giữ 100% tiền vận tải
 * (tự động), các lô còn lại 0đ") must materialize on the money boards even
 * when the grouped lots have no live trip yet (chưa phân bổ xe — exactly the
 * customer's reported state). LCL lots have no intake freeze (no rate key is
 * derivable without containers), so the merge's own class-lane resolution is
 * the only price authority; it lands as a shipment-level (trip-less) freight
 * snapshot — the grain both money boards already read for the AUTO freight
 * column, and the grain a later dispatch freeze lawfully supersedes.
 *
 * INSERT-only like every snapshot write (chốt 2026-09-09 Câu 2 = A): the
 * supersede contract is max(id)-wins, never UPDATE.
 *
 * `note` rides `formula_text` — the column the schema reserves for frozen
 * prose the id-based rebuild cannot express, and the column the read side
 * PREFERS over that rebuild (`snap.formulaText ?? buildFormulaHint(row)`).
 * These rows carry all-zero trace ids (the merge resolves a class-lane price,
 * not the id-based engine), so without the note the reader would print a
 * wrong "thiếu điều khoản cước tự động — cần nhập tay" hint. Mirrors the
 * surcharge-pending path, which also sets `formula` + `formulaText` to the
 * same string. `formula` itself is never persisted (by design — the reader
 * rebuilds it from trace ids); it is required by `ResolvedFreightRate` only.
 */
async function insertRevMergeSnapshot(tx: Tx, shipmentId: number, amount: number, note: string): Promise<number> {
  const synthesized: Omit<ResolvedFreightRate, 'formula' | 'formulaText'> = {
    freight: amount,
    surcharge: 0,
    total: amount,
    fuelDelta: 0,
    fuelPricePeriodId: 0,
    rateTermsId: 0,
    pricingTableId: 0,
    fuelNormId: 0,
    billedKm: 0,
    liters: 0,
    sharePct: 0,
    source: 'AUTO',
  };
  return persistFreightRateSnapshot({ ...synthesized, formula: note, formulaText: note }, {
    shipmentId,
    tripId: null,
    executor: tx,
  });
}

/** Latest shipment-level (trip-less) snapshot total for the lot, if any. */
async function latestShipmentLevelSnapshotAmount(tx: Tx, shipmentId: number): Promise<number | null> {
  const rows = await tx.select({ totalAmount: s.freightRateSnapshots.totalAmount })
    .from(s.freightRateSnapshots)
    .where(and(
      eq(s.freightRateSnapshots.shipmentId, shipmentId),
      isNull(s.freightRateSnapshots.tripId),
    ))
    .orderBy(s.freightRateSnapshots.id);
  const latest = rows.at(-1);
  return latest ? Number(latest.totalAmount) : null;
}

function auditGroupChange(
  tx: Tx,
  actor: LclGroupActor,
  event: AuditEventTypeValue,
  principal: ShipmentRow,
  metadata: Record<string, unknown>,
): Promise<number> {
  return persistAuditInTransaction(tx, {
    event,
    entityType: 'shipment',
    entityId: principal.id,
    entityKey: lotReference(principal),
    actorRole: actor.role,
    actorName: actor.actorName,
    metadata,
  });
}

type AuditEventTypeValue = (typeof AuditEvent)[keyof typeof AuditEvent];

// ─── 161026232309 — the group's vehicle source (nhà xe / đội xe nội bộ) ──────

/** OWN = Đội xe nội bộ SilverSea; EXTERNAL = Nhà thầu (xe ngoài). */
type LclCostCarrierType = 'OWN' | 'EXTERNAL';

/** The vehicle source one cost group was assigned to. */
export interface LclCostCarrier {
  carrierType: LclCostCarrierType;
  /** customers.id of the nhà xe (isCarrier); null for the internal fleet. */
  carrierId: number | null;
  /** Price-board lane key: the carrier customer's linked supplier row. */
  supplierId: number | null;
  /** carrier_fleet_vehicles.id when the BKS is in that carrier's fleet. */
  carrierVehicleId: number | null;
}

/**
 * Resolve the vehicle source of a cost-group assignment.
 *
 *  - An explicit nhà xe (`carrierId`) must be a live ACTIVE isCarrier
 *    customer — the same row every "Chọn nhà xe" dropdown reads. Its linked
 *    supplier row keys the cước-trả price lane.
 *  - Without one, the source is derived: an internal-fleet BKS ⇒ OWN, a
 *    truck-tonnage class (100% xe ngoài) ⇒ EXTERNAL.
 *  - A truck-tonnage class NEVER resolves to OWN: the internal fleet is
 *    refused server-side whatever the client sends.
 */
async function resolveLclCostCarrier(
  tx: Tx,
  input: AssignLclCostGroupInput,
  vehicleClass: { isContainer: boolean },
  actualTruckNo: string,
  internalTruckId: number | null,
): Promise<LclCostCarrier> {
  const externalOnly = lclVehicleSourcingRule(vehicleClass.isContainer) === LclVehicleSourcing.EXTERNAL_ONLY;

  if (input.carrierId != null) {
    if (input.carrierType === 'OWN') {
      throw new ApiError(400, 'Nhà xe ngoài và Đội xe nội bộ loại trừ nhau — chọn một nguồn xe');
    }
    const [carrier] = await tx.select({
      id: s.customers.id,
      isCarrier: s.customers.isCarrier,
      status: s.customers.status,
      linkedSupplierId: s.customers.linkedSupplierId,
    }).from(s.customers)
      .where(and(eq(s.customers.id, input.carrierId), isNull(s.customers.deletedAt)))
      .limit(1);
    if (!carrier || !carrier.isCarrier || carrier.status !== 'ACTIVE') {
      throw new ApiError(409, 'Nhà xe không tồn tại hoặc không còn hoạt động.');
    }
    const [vehicle] = await tx.select({ id: s.carrierFleetVehicles.id })
      .from(s.carrierFleetVehicles)
      .where(and(
        eq(s.carrierFleetVehicles.carrierId, carrier.id),
        // Same normalization the carrier-vehicle catalog stores
        // (carrier_fleet_vehicle.service formatPlate + strip separators).
        eq(s.carrierFleetVehicles.normalizedPlate, actualTruckNo.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')),
        eq(s.carrierFleetVehicles.isActive, true),
        isNull(s.carrierFleetVehicles.deletedAt),
      ))
      .limit(1);
    return {
      carrierType: 'EXTERNAL',
      carrierId: carrier.id,
      supplierId: carrier.linkedSupplierId ?? null,
      carrierVehicleId: vehicle?.id ?? null,
    };
  }

  const carrierType: LclCostCarrierType = input.carrierType
    ?? (externalOnly ? 'EXTERNAL' : internalTruckId != null ? 'OWN' : 'EXTERNAL');
  if (externalOnly && carrierType === 'OWN') {
    throw new ApiError(400, 'Hàng lẻ xe tải 100% xe ngoài — chọn Nhà xe (Xe ngoài), không dùng xe nội bộ');
  }
  return { carrierType, carrierId: null, supplierId: null, carrierVehicleId: null };
}

/**
 * Persist the group's chosen vehicle source on every member lot.
 *
 * The carrier identity rides the lot's fulfillment "phân bổ xe" channel —
 * the exact field set the CUS carrier allocation and the dispatch issue-order
 * write and the Kế hoạch Chi tiết read renders — so the dispatcher reopens the
 * lot and still sees WHICH nhà xe (not only a plate string). The BKS is
 * mirrored too: single-sourced with `shipments.actual_truck_no` (see
 * also updateLclGroupTruck) so the two never drift.
 */
async function persistLclCostCarrier(
  tx: Tx,
  shipmentIds: number[],
  carrier: LclCostCarrier,
  actualTruckNo: string,
): Promise<void> {
  const fulfillments = await tx.select({
    id: s.shipmentFulfillments.id,
    version: s.shipmentFulfillments.version,
  }).from(s.shipmentFulfillments)
    .where(and(
      inArray(s.shipmentFulfillments.shipmentId, shipmentIds),
      isNull(s.shipmentFulfillments.canceledAt),
    ))
    .orderBy(asc(s.shipmentFulfillments.id));
  for (const fulfillment of fulfillments) {
    await tx.update(s.shipmentFulfillments).set({
      plannedCarrierType: carrier.carrierType,
      plannedExternalCarrierId: carrier.carrierId,
      plannedExternalCarrierVehicleId: carrier.carrierVehicleId,
      plannedVehiclePlateNumber: actualTruckNo,
      version: fulfillment.version + 1,
      updatedAt: new Date(),
    }).where(eq(s.shipmentFulfillments.id, fulfillment.id));
  }
}

/**
 * 161026232319 / card 171026142500 — Lô 1's cước trả ĐV and the members'
 * zeroing live in `lcl-cost-group-freight.service.ts` (the money seam shared
 * by group assignment and trip issuance).
 */
import { applyPrincipalCostFreight, zeroMemberDriverMoney } from './lcl-cost-group-freight.service';

/**
 * FB-092 — dispatch "Gán xe nhóm" (COST dimension).
 *
 * Sourcing rule (FB-090/161026232309): a truck-tonnage class is 100% xe ngoài,
 * so its BKS thực must NOT belong to the internal fleet and the group's nhà xe
 * (nhà thầu) is the vehicle source; container classes accept the SilverSea
 * internal fleet OR a nhà thầu.
 *
 * Money (161026232319/161026232329): Lô 1 carries 100% of the cước trả ĐV —
 * the manual entry when dispatch typed one, else the carrier price board for
 * the lane — while members 2..N are zeroed. In an internal-fleet container
 * group the driver's road money (lương chuyến + tiền đường) is counted once
 * too: it stays on Lô 1 and members 2..N shed it.
 */
export async function assignLclCostGroup(
  input: AssignLclCostGroupInput,
  actor: LclGroupActor,
): Promise<LclGroupAssignResult> {
  return db.transaction(async (tx) => {
    if (input.shipmentIds.length < 2) {
      throw new ApiError(400, 'Nhóm ghép cần ít nhất 2 lô');
    }
    const rows = await lockShipments(tx, input.shipmentIds);
    assertGroupable(rows, input.shipmentIds, 'COST');
    const vehicleClass = await loadVehicleClass(tx, input.vehicleSizeClassId);
    const actualTruckNo = input.actualTruckNo.trim();
    const billingTruckNo = (input.billingTruckNo?.trim() || actualTruckNo);
    // SPEC 18/10/2026 §2.3 — per-lot "BKS báo khách". The group value is the
    // default; an override must name a lot in this very group.
    const billingByShipment = new Map(
      (input.billingTruckNos ?? []).map((entry) => [entry.shipmentId, entry.billingTruckNo.trim()]),
    );
    for (const shipmentId of billingByShipment.keys()) {
      if (!input.shipmentIds.includes(shipmentId)) {
        throw new ApiError(400, 'BKS báo khách từng lô phải thuộc nhóm lô đang gán');
      }
    }

    const [internalTruck] = await tx.select({ id: s.trucks.id })
      .from(s.trucks)
      .where(eq(s.trucks.licensePlate, actualTruckNo))
      .limit(1);
    if (lclVehicleSourcingRule(vehicleClass.isContainer) === LclVehicleSourcing.EXTERNAL_ONLY && internalTruck) {
      throw new ApiError(400, `Hàng lẻ xe tải 100% xe ngoài — BKS ${actualTruckNo} là xe nội bộ, chọn BKS nhà xe`);
    }
    const carrier = await resolveLclCostCarrier(tx, input, vehicleClass, actualTruckNo, internalTruck?.id ?? null);
    // 161026232329 — only the internal fleet's container group pays a
    // SilverSea driver for the run; an outside carrier pays its own.
    const ownContainerGroup = carrier.carrierType === 'OWN' && vehicleClass.isContainer;

    // Selection order becomes group order: index 0 = Lô 1 (principal).
    const byId = new Map(rows.map((row) => [row.id, row]));
    const ordered = input.shipmentIds.map((id) => byId.get(id)!);
    const tripFacts = await loadLiveTripFactsByShipment(tx, ordered.map((row) => row.id));
    await assertMergeableMoney(tx, ordered, tripFacts);

    const groupId = randomUUID();
    let principalFreight: { amount: string; source: 'MANUAL' | 'PRICE_BOARD' } | null = null;
    for (const [index, row] of ordered.entries()) {
      await tx.update(s.shipments).set({
        costGroupId: groupId,
        costGroupOrder: index + 1,
        actualTruckNo,
        billingTruckNo: billingByShipment.get(row.id) ?? billingTruckNo,
        costVehicleClassId: vehicleClass.id,
        version: row.version + 1,
        updatedBy: actor.userId,
        updatedAt: new Date(),
      }).where(eq(s.shipments.id, row.id));

      const trip = tripFacts.get(row.id);
      if (index === 0) {
        // The lane's own source rides Lô 1's trip (the internal fleet pays a
        // SilverSea driver; an outside nhà xe does not) alongside its 100%
        // cước trả ĐV — manual entry wins, else the price board.
        if (trip) await upsertTripCarrierInfo(tx, trip.tripId, { carrierType: carrier.carrierType });
        principalFreight = await applyPrincipalCostFreight(tx, {
          row,
          trip: trip ?? null,
          vehicleClassId: vehicleClass.id,
          carrier,
          manualFreightCost: input.freightCost,
        });
        continue;
      }
      // "Nhảy tiền" — members 2..N stop paying the vendor: their live trip's
      // external freight cost is zeroed.
      if (!trip) continue;
      await upsertTripCarrierInfo(tx, trip.tripId, {
        carrierType: carrier.carrierType,
        externalFreightCost: '0',
      });
      if (ownContainerGroup) {
        await zeroMemberDriverMoney(tx, trip.tripId);
      }
    }

    // The chosen nhà xe / đội xe nội bộ is a fact of every member lot, not a
    // transient dialog state — persisted on the lots so a reopen redisplays it.
    await persistLclCostCarrier(tx, ordered.map((row) => row.id), carrier, actualTruckNo);

    await auditGroupChange(tx, actor, AuditEvent.SHIPMENT_LCL_COST_GROUP_ASSIGNED, ordered[0]!, {
      dimension: 'COST',
      groupId,
      memberCount: ordered.length,
      vehicleClassCode: vehicleClass.code,
      actualTruckNo,
      billingTruckNo,
      carrierType: carrier.carrierType,
      carrierId: carrier.carrierId,
      carrierVehicleId: carrier.carrierVehicleId,
      principalFreight,
      driverMoneyZeroedForMembers: ownContainerGroup,
      members: ordered.map((row, index) => ({ shipmentId: row.id, order: index + 1 })),
    });

    return {
      groupId,
      memberCount: ordered.length,
      members: ordered.map((row, index) => ({
        shipmentId: row.id,
        order: index + 1,
        reference: lotReference(row),
      })),
    };
  });
}

/**
 * FB-093 — CUS "Ghép cước thu khách" (REV dimension).
 *
 * Only same-customer lots may share a bill. Lô 1 keeps 100% of CƯỚC VẬN TẢI —
 * re-priced AUTO from the customer × route × vehicle-class lane when one
 * exists — while members 2..N are zeroed with reason "Ghép cước cùng Bill X".
 */
export async function mergeLclRevGroup(
  input: MergeLclRevGroupInput,
  actor: LclGroupActor,
): Promise<LclGroupAssignResult> {
  return db.transaction(async (tx) => {
    if (input.shipmentIds.length < 2) {
      throw new ApiError(400, 'Nhóm ghép cần ít nhất 2 lô');
    }
    const rows = await lockShipments(tx, input.shipmentIds);
    assertGroupable(rows, input.shipmentIds, 'REV');
    const vehicleClass = await loadVehicleClass(tx, input.vehicleSizeClassId);

    const customerId = rows[0]!.customerId;
    if (customerId == null || rows.some((row) => row.customerId !== customerId)) {
      const customerIds = Array.from(new Set(rows.map((row) => row.customerId).filter((id): id is number => id != null)));
      const customerRows = customerIds.length > 0
        ? await tx.select({ id: s.customers.id, name: s.customers.name })
            .from(s.customers)
            .where(inArray(s.customers.id, customerIds))
        : [];
      const customerNameMap = new Map(customerRows.map((c) => [c.id, c.name]));
      const details = rows.map((r) => {
        const custName = r.customerId ? (customerNameMap.get(r.customerId) ?? `ID ${r.customerId}`) : 'Chưa có khách hàng';
        return `Lô ${lotReference(r)} (Khách hàng: ${custName})`;
      }).join(', ');
      throw new ApiError(
        400,
        `Chỉ cho phép ghép các lô của cùng một khách hàng (CÙNG 1 KHÁCH HÀNG) — phát hiện xung đột: ${details}`,
      );
    }

    const byId = new Map(rows.map((row) => [row.id, row]));
    const ordered = input.shipmentIds.map((id) => byId.get(id)!);
    const tripFacts = await loadLiveTripFactsByShipment(tx, ordered.map((row) => row.id));
    await assertMergeableMoney(tx, ordered, tripFacts);

    const groupId = randomUUID();
    const principalRef = lotReference(ordered[0]!);
    // BKS ảo chung nhóm: explicit input wins; else keep the lot's existing
    // billing; else copy the actual BKS a cost-group assignment may have set.
    const billingTruckNo = input.billingTruckNo?.trim()
      || ordered[0]!.billingTruckNo?.trim()
      || ordered[0]!.actualTruckNo?.trim()
      || null;

    for (const [index, row] of ordered.entries()) {
      await tx.update(s.shipments).set({
        revGroupId: groupId,
        revGroupOrder: index + 1,
        revVehicleClassId: vehicleClass.id,
        ...(billingTruckNo != null ? { billingTruckNo } : {}),
        version: row.version + 1,
        updatedBy: actor.userId,
        updatedAt: new Date(),
      }).where(eq(s.shipments.id, row.id));

      const trip = tripFacts.get(row.id);
      if (!trip) {
        // 161026204709: no live trip yet — the money still materializes as a
        // shipment-level snapshot (see insertRevMergeSnapshot). The principal
        // keeps the resolved lane price; a member takes a cited 0₫ (a
        // computed zero is a value — D02 law). Lane miss ⇒ principal stays
        // MANUAL/blank, same semantics as the trip-ful branch.
        if (index === 0) {
          if (row.routeId != null && row.expectedDeliveryDate != null) {
            const price = await resolveCustomerVehicleClassPrice({
              customerId,
              routeId: row.routeId,
              vehicleSizeClassId: vehicleClass.id,
              date: row.expectedDeliveryDate,
            });
            if (price != null) {
              await insertRevMergeSnapshot(
                tx,
                row.id,
                price.price,
                `Ghép cước thu khách — Lô 1 giữ 100% (bảng giá khách × tuyến × ${vehicleClass.code}, ngày ${row.expectedDeliveryDate})`,
              );
            }
          }
        } else {
          await insertRevMergeSnapshot(
            tx,
            row.id,
            0,
            `Ghép cước cùng Bill ${principalRef} — lô ghép giữ 0₫ cước thu (chưa phân bổ xe)`,
          );
        }
        continue;
      }
      if (index === 0) {
        // Lô 1 = 100% CƯỚC VẬN TẢI (AUTO): resolve the customer × route ×
        // class lane at the lot's delivery date. No lane ⇒ keep the current
        // revenue (MANUAL semantics; the pricing lookup never throws).
        if (row.routeId != null && row.expectedDeliveryDate != null) {
          const price = await resolveCustomerVehicleClassPrice({
            customerId,
            routeId: row.routeId,
            vehicleSizeClassId: vehicleClass.id,
            date: row.expectedDeliveryDate,
          });
          if (price != null) {
            await upsertTripFinancialState(tx, trip.tripId, { revenue: String(price.price) });
          }
        }
      } else {
        // Members 2..N = 0₫, stamped with the standard override markers so
        // accounting can always answer "why is this zero" (card law: a
        // computed financial zero is a value — it must cite its reason).
        const previous = trip.revenueOriginal ?? trip.revenue ?? '0';
        await upsertTripFinancialState(tx, trip.tripId, {
          revenue: '0',
          revenueOriginal: previous,
          revenueOverriddenBy: actor.userId,
          revenueOverriddenAt: new Date(),
          revenueOverrideReason: `Ghép cước cùng Bill ${principalRef}`,
        });
      }
    }

    await auditGroupChange(tx, actor, AuditEvent.SHIPMENT_LCL_REV_GROUP_MERGED, ordered[0]!, {
      dimension: 'REV',
      groupId,
      memberCount: ordered.length,
      vehicleClassCode: vehicleClass.code,
      customerId,
      principalRef,
      members: ordered.map((row, index) => ({ shipmentId: row.id, order: index + 1 })),
    });

    return {
      groupId,
      memberCount: ordered.length,
      members: ordered.map((row, index) => ({
        shipmentId: row.id,
        order: index + 1,
        reference: lotReference(row),
      })),
    };
  });
}

/**
 * 161026232349 (DEV SPEC Hàng lẻ §II.3.2 — "Trường hợp 1 · Thu riêng từng lô")
 * — CUS picks the thu vehicle class for ONE lot WITHOUT grouping it.
 *
 * The spec: "CUS không cần ghép ... chọn Loại xe tính cước thu khách (Xe
 * 1.25T ... Cont 20'/40') ... Cột CƯỚC VẬN TẢI (AUTO) của từng lô sẽ nhảy
 * 100% đơn giá của loại xe đã chọn cho lô đó."
 *
 * Money law — the SAME channel the money boards already read, never a
 * parallel one (revenue-override-read.service's qualification: an LCL lot
 * that is REV-grouped OR whose live trip carries an override stamp):
 *   live trip ⇒ the lot's trip_financial_state.revenue is set to the resolved
 *   customer × route × class lane price and stamped with the override markers
 *   (so the CUS board, the Kế toán board and the customer-debt report all
 *   read it — no board changes);
 *   no live trip ⇒ the merge path's shipment-level freight snapshot grain
 *   (insertRevMergeSnapshot, card 161026204709).
 * The class is stamped LAST-free: `revGroupId` is never written (no group is
 * created), and neither `costGroupId`/`costVehicleClassId` nor any cước TRẢ
 * value is touched.
 *
 * A lane miss (no price row for customer × route × class, or no route/date
 * key) writes NO money at all — the class still saves, and CƯỚC VẬN TẢI
 * (AUTO) stays "Chưa xác định" instead of a fabricated 0₫ (D02 law).
 *
 * A lot already inside a REV group is refused: the group owns its members'
 * cước thu (merge Lô-1 100% / 0₫ law), so CUS must tách nhóm first.
 */
export async function setLclLotRevClass(
  input: SetLclLotRevClassInput,
  actor: LclGroupActor,
): Promise<LclSingleLotRevClassResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(s.shipments)
      .where(and(eq(s.shipments.id, input.shipmentId), isNull(s.shipments.deletedAt)))
      .for('update');
    if (!row) throw new ApiError(404, 'Không tìm thấy lô hàng');
    if (row.cargoMode !== 'LCL') {
      throw new ApiError(400, `Lô ${lotReference(row)} không phải hàng lẻ — chỉ lô lẻ mới chọn được loại xe tính cước thu khách riêng`);
    }
    if (row.revGroupId != null) {
      throw new ApiError(
        409,
        `Lô ${lotReference(row)} đã thuộc nhóm ghép cước thu khách — tách khỏi nhóm (Hủy ghép) trước khi chọn loại xe tính cước thu riêng cho lô này`,
      );
    }
    await assertShipmentAccountingUnlocked(tx, row.id);

    const vehicleClass = await loadVehicleClass(tx, input.vehicleSizeClassId);
    const tripFacts = await loadLiveTripFactsByShipment(tx, [row.id]);
    const trip = tripFacts.get(row.id);
    if (trip && trip.status === 'COMPLETED') {
      throw new ApiError(409, `Lô ${lotReference(row)} đã hoàn thành chuyến — không đổi loại xe tính cước thu được nữa`);
    }

    await tx.update(s.shipments).set({
      revVehicleClassId: vehicleClass.id,
      version: row.version + 1,
      updatedBy: actor.userId,
      updatedAt: new Date(),
    }).where(eq(s.shipments.id, row.id));

    const reason = `Chọn loại xe tính cước thu khách — Xe ${vehicleClass.code}`;
    // The lane needs the customer (the lot's own), the route and a date to
    // price against — the merge path's own key.
    const laneDate = row.expectedDeliveryDate;
    const price = row.customerId != null && row.routeId != null && laneDate != null
      ? await resolveCustomerVehicleClassPrice({
        customerId: row.customerId,
        routeId: row.routeId,
        vehicleSizeClassId: vehicleClass.id,
        date: laneDate,
      })
      : null;

    if (price == null) {
      // Lane miss: the class saves (CUS fixes the price board later) while
      // the money column stays "Chưa xác định" — never a fabricated 0₫.
      await auditGroupChange(tx, actor, AuditEvent.SHIPMENT_UPDATED, row, {
        dimension: 'REV',
        action: 'rev-class-single-lot',
        vehicleSizeClassId: vehicleClass.id,
        vehicleClassCode: vehicleClass.code,
        channel: 'NONE',
        freightAuto: null,
      });
      return {
        shipmentId: row.id,
        reference: lotReference(row),
        vehicleSizeClassId: vehicleClass.id,
        vehicleClassCode: vehicleClass.code,
        freightAuto: null,
        channel: 'NONE',
        reason: null,
      };
    }

    if (trip) {
      const previous = trip.revenueOriginal ?? trip.revenue ?? '0';
      await upsertTripFinancialState(tx, trip.tripId, {
        revenue: String(price.price),
        revenueOriginal: previous,
        revenueOverriddenBy: actor.userId,
        revenueOverriddenAt: new Date(),
        revenueOverrideReason: reason,
      });
    } else {
      await insertRevMergeSnapshot(
        tx,
        row.id,
        price.price,
        `Chọn loại xe tính cước thu khách — 100% bảng giá khách × tuyến × ${vehicleClass.code}, ngày ${laneDate}`,
      );
    }

    await auditGroupChange(tx, actor, AuditEvent.SHIPMENT_UPDATED, row, {
      dimension: 'REV',
      action: 'rev-class-single-lot',
      vehicleSizeClassId: vehicleClass.id,
      vehicleClassCode: vehicleClass.code,
      channel: trip ? 'TRIP' : 'SNAPSHOT',
      freightAuto: price.price,
    });

    return {
      shipmentId: row.id,
      reference: lotReference(row),
      vehicleSizeClassId: vehicleClass.id,
      vehicleClassCode: vehicleClass.code,
      freightAuto: String(price.price),
      channel: trip ? 'TRIP' : 'SNAPSHOT',
      reason,
    };
  });
}

/**
 * FB-093 — quick-edit the BKS pair from the settlement screen.
 *
 * The two plates have different scopes (spec §2.3, card 181026145000):
 *   - BKS thực (actualTruckNo) is the COST group's shared identity — one
 *     physical truck runs the whole group, so an edit rewrites every live
 *     member (the lot alone when ungrouped);
 *   - BKS báo khách (billingTruckNo) is per-lot — "cho phép điều vận sửa lại
 *     cho từng lô trong nhóm" — so an edit touches ONLY the named lot. The
 *     group's shared billing value is set once at assignment/merge time;
 *     divergence afterwards is the operator's deliberate per-lot choice.
 */
export async function updateLclGroupTruck(
  input: UpdateLclTruckInput,
  actor: LclGroupActor,
): Promise<{ updatedShipmentIds: number[] }> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(s.shipments)
      .where(and(eq(s.shipments.id, input.shipmentId), isNull(s.shipments.deletedAt)))
      .for('update');
    if (!row) throw new ApiError(404, 'Không tìm thấy lô hàng');
    if (input.actualTruckNo == null && input.billingTruckNo == null) {
      throw new ApiError(400, 'Không có gì để cập nhật — truyền BKS thực hoặc BKS báo khách');
    }
    await assertShipmentAccountingUnlocked(tx, row.id);

    // The cost group shares one physical truck; ungrouped edits touch the lot.
    const groupTargets = input.actualTruckNo != null && row.costGroupId != null
      ? await tx.select().from(s.shipments)
        .where(and(eq(s.shipments.costGroupId, row.costGroupId), isNull(s.shipments.deletedAt)))
        .orderBy(asc(s.shipments.id))
        .for('update')
      : [row];

    // Review 181026145000 (LCL-A181026145000-05) — the actual-plate edit
    // rewrites EVERY live group member, so the settled-group law applies to
    // the whole group: every member must be accounting-unlocked, not just the
    // named lot (the accounting leg of the unmerge path's assertGroupMutable;
    // its completed-trip freeze is deliberately not mirrored here). A
    // billing-only edit touches the named lot alone — the early assert above
    // is its whole boundary.
    if (input.actualTruckNo != null) {
      for (const target of groupTargets) {
        if (target.id === row.id) continue;
        try {
          await assertShipmentAccountingUnlocked(tx, target.id);
        } catch {
          throw new ApiError(409, `Nhóm ghép đã chốt kế toán — Lô ${lotReference(target)} đang khóa sổ, không sửa BKS thực của nhóm được`);
        }
      }
    }

    // Which rows actually change: the actual plate rides every group member,
    // the billing plate only the named lot — a billing-only edit must not
    // bump versions of siblings it did not touch.
    const touched = new Map<number, ShipmentRow>();
    if (input.actualTruckNo != null) {
      for (const target of groupTargets) touched.set(target.id, target);
    }
    if (input.billingTruckNo != null) touched.set(row.id, row);

    const updatedIds: number[] = [];
    for (const target of touched.values()) {
      const patch: Partial<typeof s.shipments.$inferInsert> = {
        updatedBy: actor.userId,
        updatedAt: new Date(),
      };
      if (input.actualTruckNo != null) patch.actualTruckNo = input.actualTruckNo;
      if (input.billingTruckNo != null && target.id === row.id) {
        patch.billingTruckNo = input.billingTruckNo;
      }
      await tx.update(s.shipments).set({ ...patch, version: target.version + 1 })
        .where(eq(s.shipments.id, target.id));
      updatedIds.push(target.id);
    }

    // 161026232309 — the lot's "phân bổ xe" channel carries the same BKS (the
    // group's vehicle source is persisted there), so an edit here must not
    // leave it showing the truck the group no longer runs. Only rows that
    // already hold an assignment are mirrored: a lot with no vehicle source
    // is never silently stamped as assigned.
    if (input.actualTruckNo != null) {
      const assigned = await tx.select({
        id: s.shipmentFulfillments.id,
        version: s.shipmentFulfillments.version,
      }).from(s.shipmentFulfillments)
        .where(and(
          inArray(s.shipmentFulfillments.shipmentId, updatedIds),
          isNull(s.shipmentFulfillments.canceledAt),
          or(
            isNotNull(s.shipmentFulfillments.plannedCarrierType),
            isNotNull(s.shipmentFulfillments.plannedExternalCarrierId),
          ),
        ))
        .orderBy(asc(s.shipmentFulfillments.id));
      for (const fulfillment of assigned) {
        await tx.update(s.shipmentFulfillments).set({
          plannedVehiclePlateNumber: input.actualTruckNo,
          version: fulfillment.version + 1,
          updatedAt: new Date(),
        }).where(eq(s.shipmentFulfillments.id, fulfillment.id));
      }
    }

    await auditGroupChange(tx, actor, AuditEvent.SHIPMENT_UPDATED, row, {
      dimension: 'COST',
      action: 'truck-quick-edit',
      updatedShipmentIds: updatedIds,
      actualTruckNo: input.actualTruckNo ?? undefined,
      billingTruckNo: input.billingTruckNo ?? undefined,
    });
    return { updatedShipmentIds: updatedIds };
  });
}
