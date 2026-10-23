/**
 * LCL lot grouping (FB-092/093, spec 23/10 / 261023110000).
 *
 * One lô may share a physical truck with other lôs. Two independent money
 * dimensions group independently on `shipments` (cost-group patches NEVER
 * carry a rev key and vice versa — lcl-grouping-law.ts):
 *   COST — cước trả ĐV: dispatch assigns one truck to N lots ("Gán xe nhóm",
 *          FB-092, popup = exactly 4 fields: Loại xe tính cước trả ĐV, Nhà
 *          xe, BKS thực, Cước trả ĐVVC blank=auto/manual=override). Lô 1
 *          keeps 100% of the vendor freight; Lô 2..N's live trip
 *          external_freight_cost is zeroed. The ĐV flow never writes BKS
 *          báo khách (spec 23/10 — that is a CUS concept).
 *   REV  — cước thu khách: CUS merges N same-customer lots into one bill
 *          (FB-093). Spec 23/10: INSIDE an actively merged group the money
 *          is 100%/0₫ — Lô 1 carries the group's whole cước thu (manual
 *          "Cước thu Lô 1" when CUS typed one, else bảng giá thu khách),
 *          members 2..N are 0₫ stamped/tagged `LCL_REV_MERGE_TAG`. The boss
 *          ruling 21/10 (thu per-lot đơn giá × SL) remains the DEFAULT
 *          outside a merged group (setLclLotRevClass per-lot outputs).
 *
 * The promote-on-unmerge safety law (FB-095) lives here too. COST: a principal
 * leaving hands Lô-1 rights + the whole cước trả line (1 dòng/chuyến) to the
 * next member. REV (23/10, the FB-093 100%/0₫ law): tách Lô 1 CHUYỂN 100%
 * cước thu cho Lô kế (the group never falls to 0₫); tách cả nhóm trả tiền về
 * trạng thái trước ghép (restoreRevPreMergeMoney); một thành viên tách riêng
 * giữ cước hiện tại + lý do chờ định giá lại.
 */
import { and, asc, eq, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db, type Tx } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import { lclVehicleSourcingRule, LclVehicleSourcing, assessLclCargoFit, LCL_REV_MERGE_TAG, type LclCargoFitAssessment } from '@tingting/shared';
import type {
  AssignLclCostGroupInput,
  LclGroupDimension,
  MergeLclRevGroupInput,
  SetLclLotRevClassInput,
  UnmergeLclLotInput,
  UnmergeLclGroupInput,
  UpdateLclCostGroupInput,
  UpdateLclTruckInput,
} from '@tingting/shared';
import { AuditEvent } from './audit-types';
import { persistAuditInTransaction } from './audit.service';
import { assertShipmentAccountingUnlocked } from './shipment-accounting-lock-reads.service';
import { upsertTripCarrierInfo, upsertTripFinancialState } from './trip-composite.service';
import { resolveCustomerVehicleClassPrice } from './pricing.service';
import { persistFreightRateSnapshot, type ResolvedFreightRate } from './freight-pricing-engine.service';
import {
  assertSameRevCustomer,
  costGroupMemberPatch,
  findRevCustomerConflict,
  revGroupMemberPatch,
} from './lcl-grouping-law';

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
  /** Spec 23/10 — `LCL_REV_MERGE_TAG` on Lô 2..N of a REV group (the
   *  API's "field/tag"): their cước thu is 0₫ because it rides Lô 1. */
  revMergeTag?: string | null;
}

export interface LclGroupAssignResult {
  groupId: string;
  memberCount: number;
  members: LclGroupMemberResult[];
  /**
   * REQ-19 depth audit (2026-10-21) — the group's cargo-fit advisory:
   * Σ known cargoWeightKg of the members vs the chosen class' tonnage.
   * Advisory only; never blocks, never reprices (the spec's money law is
   * the Lô-1-100%/0₫ board price). Present on COST assignments (the
   * physical-truck dimension).
   */
  cargoFit?: LclCargoFitAssessment;
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
 * 161026232349 (§II.3.2 "Thu riêng từng lô") + spec 23/10 §4.1 — one
 * ungrouped lot's per-lot CUS outputs: the thu class stamp plus the cước thu
 * that landed (manual "Giá cước thu khách" wins over the traced lane price).
 * `freightAuto` is null (never 0) when the customer × route × class lane
 * holds no price row — the class still saves so CUS can fix the price later.
 */
export interface LclSingleLotRevClassResult {
  shipmentId: number;
  reference: string;
  /** The effective thu class after the call (unchanged when only the price
   *  was edited; null = the lot had no class and none was sent). */
  vehicleSizeClassId: number | null;
  /** vehicle_size_classes.code, e.g. '5T' / 'CONT20' (null = no class). */
  vehicleClassCode: string | null;
  /** The traced lane price (VND); null = lane miss — never fabricated. */
  freightAuto: string | null;
  /** The manual Giá cước thu khách (VND) CUS typed; null = auto mode. */
  freightManual: string | null;
  /** The amount actually written (manual ?? auto); null = nothing written. */
  freight: string | null;
  /** TRIP = the lot's live trip carries the override stamp; SNAPSHOT = the
   *  lot has no live trip and the money materialized at the merge path's
   *  shipment-level grain; NONE = no lane price and no manual ⇒ nothing. */
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
  /** The revenue-override stamp text ("Ghép cước cùng Bill X", FB-095
   *  re-stamps, operator M2.1 reasons) — the whole-group restore must tell a
   *  group note from an operator's own before touching the money. */
  revenueOverrideReason: string | null;
  /** Spec 23/10 (review C1) — the cước thu captured when the lot joined its
   *  rev group ("trạng thái trước ghép"), with an explicit captured flag so a
   *  pre-merge NULL restores to "Chưa xác định" (never a fabricated 0₫). */
  revenuePreGroup: string | null;
  revenuePreGroupCaptured: boolean;
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
    revenueOverrideReason: s.tripFinancialState.revenueOverrideReason,
    revenuePreGroup: s.tripFinancialState.revenuePreGroup,
    revenuePreGroupCaptured: s.tripFinancialState.revenuePreGroupCaptured,
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
        revenueOverrideReason: row.revenueOverrideReason,
        revenuePreGroup: row.revenuePreGroup,
        revenuePreGroupCaptured: row.revenuePreGroupCaptured ?? false,
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
        `Nhóm ghép đã chốt kế toán — Lô ${lotReference(member)} đang khóa sổ, không thể thay đổi nhóm ghép`,
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
 * ungrouped and unpriced until it groups again. A COST leaver also sheds the
 * manual "Cước trả ĐVVC" (spec 23/10) — that override is group money and
 * follows the crown (`rewriteSurvivors` inheritance).
 */
function clearLeaverDimensionPatch(dimension: LclGroupDimension): Partial<typeof s.shipments.$inferInsert> {
  return dimension === 'COST'
    ? { costGroupId: null, costGroupOrder: null, costVehicleClassId: null, costGroupFreightManual: null }
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

/**
 * Write the renumbered survivor rows (a lone survivor dissolves the group).
 * `inheritCostGroupFreightManual` (COST principal-exit only) hands the
 * leaving principal's manual "Cước trả ĐVVC" to the new Lô 1 — the override
 * travels with the 100% cước trả line, never with the leaver.
 */
async function rewriteSurvivors(
  tx: Tx,
  dimension: LclGroupDimension,
  survivors: ShipmentRow[],
  groupId: string,
  actor: LclGroupActor,
  inheritCostGroupFreightManual?: string | null,
): Promise<void> {
  const dissolved = survivors.length === 1;
  for (const [index, survivor] of survivors.entries()) {
    const patch: Partial<typeof s.shipments.$inferInsert> = {
      updatedBy: actor.userId,
      updatedAt: new Date(),
      version: survivor.version + 1,
    };
    if (inheritCostGroupFreightManual !== undefined && index === 0) {
      patch.costGroupFreightManual = inheritCostGroupFreightManual;
    }
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
 * group in the given dimension. COST (1 dòng/chuyến): the crown inherits the
 * whole cước trả line + driver road money + the manual Cước trả ĐVVC — never
 * falls to 0₫. REV (spec 23/10, FB-093 100%/0₫): the crown hands the whole
 * cước thu to the next member. `leaverIsDeleted` (the soft-delete hook)
 * suppresses the leaver-side restate writes — the row is going away, so its
 * 0₫ note would be history noise.
 */
async function promotePrincipalOnRemoval(
  tx: Tx,
  dimension: LclGroupDimension,
  groupId: string,
  leaver: ShipmentRow,
  orderedMembers: ShipmentRow[],
  tripFacts: Map<number, LiveTripFacts>,
  actor: LclGroupActor,
  options?: { leaverIsDeleted?: boolean },
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
    await rewriteSurvivors(tx, dimension, survivors, groupId, actor, leaver.costGroupFreightManual ?? null);
    return {
      promoted: { shipmentId: promotee.id, order: 1, reference: lotReference(promotee) },
      // COST still transfers the whole vendor line (1 dòng/chuyến): the crown
      // inherits the single external-freight amount, so report it here.
      transferredAmount: freight != null && Number(freight) !== 0 ? freight : null,
      transferredDriverMoney,
    };
  }

  // REV — spec 23/10 restores the FB-093 100%/0₫ law: the group's cước thu
  // rides Lô 1, so the crown leaving hands the WHOLE amount to the next
  // member (the group never falls to 0₫). Channel discipline (review M1): a
  // live-trip leaver transfers its TRIP revenue only — the trip-less snapshot
  // fallback is for leavers with NO live trip (161026204709 grain), never a
  // stale snapshot pulled onto a trip-ful leaver's successor.
  const revenue = leaverTrip != null
    ? (leaverTrip.revenue != null && Number(leaverTrip.revenue) !== 0 ? leaverTrip.revenue : null)
    : await latestShipmentLevelSnapshotAmount(tx, leaver.id);
  const transferred = revenue != null && Number(revenue) !== 0;
  // Card law: a computed financial zero is a value — cite its reason. The
  // promotee sheds its member-zero stamp whether or not money follows (its
  // "Ghép thu cước cùng Lô 1" tag is stale once it IS Lô 1 — review L2).
  const promoteeReason = transferred
    ? `Đón cước chính khi tách nhóm (từ Bill ${lotReference(leaver)})`
    : `Đón cước chính khi tách nhóm (từ Bill ${lotReference(leaver)}) — chưa có cước thu để chuyển`;
  if (promoteeTrip != null) {
    await upsertTripFinancialState(tx, promoteeTrip.tripId, {
      ...(transferred ? { revenue: String(revenue) } : {}),
      revenueOverriddenBy: actor.userId,
      revenueOverriddenAt: new Date(),
      revenueOverrideReason: promoteeReason,
    });
  } else if (transferred) {
    await insertRevMergeSnapshot(
      tx,
      promotee.id,
      Number(revenue),
      `${promoteeReason} — 100% cước thu`,
    );
  } else {
    // Trip-less promotee with nothing to transfer: its member-tag snapshot
    // note is stale once it IS Lô 1 — re-cite the SAME amount (a cited 0₫
    // stays a cited 0₫; never a fresh fabrication) under the promotee reason.
    const current = await latestShipmentLevelSnapshotAmount(tx, promotee.id);
    if (current != null) {
      await insertRevMergeSnapshot(tx, promotee.id, current, promoteeReason);
    }
  }
  if (transferred && !options?.leaverIsDeleted) {
    if (leaverTrip != null) {
      await upsertTripFinancialState(tx, leaverTrip.tripId, {
        revenue: '0',
        revenueOriginal: String(revenue),
        revenuePreGroup: null,
        revenuePreGroupCaptured: false,
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
  }
  await rewriteSurvivors(tx, dimension, survivors, groupId, actor);
  return {
    promoted: { shipmentId: promotee.id, order: 1, reference: lotReference(promotee) },
    transferredAmount: transferred ? String(revenue) : null,
    transferredDriverMoney: null,
  };
}

/**
 * Un-merge / dissolve an entire LCL group in one atomic transaction.
 * All members are ungrouped.
 *
 * COST (trả ĐV): the primary member keeps 100% of the money (and vehicle
 * class) while other members stay at 0₫ awaiting re-pricing — the total
 * group freight is strictly conserved (SPEC §4 "Tách nhóm" copy).
 *
 * REV (thu khách — spec 23/10, FB-093 law): "Tách nhóm" here is CUS's
 * "hủy gộp về lại từng xe riêng" — `restoreRevPreMergeMoney` returns every
 * lot's cước thu to its pre-merge state (live trips to `revenueOriginal`,
 * trip-less lots re-materialize the pre-merge snapshot VERBATIM) and sheds
 * the group notes. Operator's own money edits survive untouched.
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

      if (input.dimension === 'REV') {
        await restoreRevPreMergeMoney(tx, member, tripFacts.get(member.id) ?? null);
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
 * Laws (kanban FB-095 + spec 23/10):
 *   - settled group ⇒ refused (an active accounting lock on ANY member);
 *   - leaving Lô 1 auto-promotes the next member with 100% of the money —
 *     the group's freight never falls to 0₫ (COST: cước trả + driver money +
 *     manual override follow the crown; REV: the whole cước thu moves);
 *   - a member leaving ("unmerge 1 lô về riêng") keeps its current cước and
 *     the stale group note is restated (`restateRevLeaverMoney`: cited 0₫ ⇒
 *     chờ định giá lại, a 21/10-era own cước ⇒ the per-lot marker); the
 *     survivors are renumbered, or the group dissolves when one member
 *     remains (QA C-2 — the response/audit must report the DB post-state,
 *     never a ghost group);
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

    // The leaver leaves: dimension fields cleared, version bumped. A REV
    // leaver ("1 lô về riêng") keeps its current cước — only the stale group
    // note is restated (`restateRevLeaverMoney`).
    await tx.update(s.shipments).set({
      ...clearLeaverDimensionPatch(input.dimension),
      version: leaver.version + 1,
      updatedBy: actor.userId,
      updatedAt: new Date(),
    }).where(eq(s.shipments.id, leaver.id));
    if (leaverOrder !== 1 && input.dimension === 'REV') {
      await restateRevLeaverMoney(tx, leaver, tripFacts.get(leaver.id) ?? null, actor);
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
 * to the next member inside the same transaction. The delete boundary
 * guarantees the leaver has no live trip, so its trip-channel money is
 * already gone — but a trip-less leaver may still carry a shipment-level
 * snapshot (161026204709), and that money follows the crown like every
 * other Lô-1 amount. The survivors must never point at a headless group.
 * Settled/completed members block the delete for the same reason they block
 * un-merge.
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
        // The leaver row is being soft-deleted: no leaver-side restate writes
        // (its money follows the crown to the promotee either way).
        { leaverIsDeleted: true },
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
 * 161026204709 (TC-A12) + per boss 21/10 — the REV merge promise ("mỗi lô tự
 * tính đơn giá khách × tuyến × loại xe của chính nó") must materialize on the
 * money boards even when the grouped lots have no live trip yet (chưa phân bổ
 * xe). LCL lots have no intake freeze (no rate key is derivable without
 * containers), so the merge's own class-lane resolution is the only price
 * authority; it lands as a shipment-level (trip-less) freight snapshot — the
 * grain both money boards already read for the AUTO freight column, and the
 * grain a later dispatch freeze lawfully supersedes.
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

// ─── Spec 23/10 (261023110000) — REV "Tách nhóm" of a 100%/0₫ merged group ─

/** Every prose note THIS service writes onto a lot's money. Anything else on a
 *  stamp/snapshot is an operator's own edit and must survive a tách nhóm. */
const REV_GROUP_NOTE_PREFIXES = [
  'Ghép cước',
  'Ghép thu cước',
  'Tách khỏi nhóm ghép',
  'Tách nhóm — chuyển',
  'Đón cước chính',
  'Tách nhóm — cước thu',
] as const;

function isRevGroupNote(note: string | null): boolean {
  return note != null && REV_GROUP_NOTE_PREFIXES.some((prefix) => note.startsWith(prefix));
}

/** The per-lot marker a REV lot carries once it no longer shares a bill and
 *  keeps a non-zero cước of its own (21/10-era groups). */
const REV_LOT_OWN_CUOC_REASON = 'Tách nhóm — cước thu theo đơn giá khách × tuyến (lô độc lập)';

/** A separated lot with a cited 0₫ awaits per-lot re-pricing (D02: a computed
 *  financial zero is a value — it keeps its reason). */
const REV_LOT_AWAITING_REPRICE_REASON = 'Tách khỏi nhóm ghép — chờ định giá lại';

/**
 * Whole-group "Tách nhóm" (REV) — "tiền cước về lại từng lô đúng trạng thái
 * trước ghép" (card 211026024348, FB-093 100%/0₫ law restored by spec 23/10):
 *
 *  - live trip: revenue returns to the PRE-MERGE capture the merge recorded
 *    (`revenue_pre_group` — review C1: NOT the M2.1 first-override original,
 *    which goes stale across layered overrides). A captured NULL restores to
 *    "Chưa xác định" (`revenue: null`) — never a fabricated 0₫. Groups
 *    merged before the capture existed fall back to `revenueOriginal` (the
 *    legacy law) and keep their money when even that is absent. The merge's
 *    override stamp is cleared; an operator's own note is untouched and its
 *    money kept (M2.1 law).
 *  - no live trip: re-materialize the pre-merge snapshot VERBATIM (money AND
 *    trace ids AND formulaText) over the merge's own rows so the reader
 *    rebuilds byte-for-byte the pre-merge face. No pre-merge row ⇒ a cited
 *    0₫ "chờ định giá lại" (a snapshot cannot hold null — D02).
 */
async function restoreRevPreMergeMoney(
  tx: Tx,
  member: ShipmentRow,
  trip: LiveTripFacts | null,
): Promise<void> {
  if (trip != null) {
    const reason = trip.revenueOverrideReason;
    if (reason != null && !isRevGroupNote(reason)) return;
    await upsertTripFinancialState(tx, trip.tripId, {
      ...(trip.revenuePreGroupCaptured
        // The capture is authoritative: a pre-merge NULL restores to null.
        ? { revenue: trip.revenuePreGroup }
        // Legacy group (merged before the capture existed): the old law.
        : trip.revenueOriginal != null
          ? { revenue: trip.revenueOriginal }
          : {}),
      revenuePreGroup: null,
      revenuePreGroupCaptured: false,
      revenueOverriddenBy: null,
      revenueOverriddenAt: null,
      revenueOverrideReason: null,
    });
    return;
  }

  const rows = await tx.select({
    freightAmount: s.freightRateSnapshots.freightAmount,
    surchargeAmount: s.freightRateSnapshots.surchargeAmount,
    totalAmount: s.freightRateSnapshots.totalAmount,
    rateTermsId: s.freightRateSnapshots.rateTermsId,
    pricingTableId: s.freightRateSnapshots.pricingTableId,
    fuelNormId: s.freightRateSnapshots.fuelNormId,
    fuelPricePeriodId: s.freightRateSnapshots.fuelPricePeriodId,
    billedKm: s.freightRateSnapshots.billedKm,
    liters: s.freightRateSnapshots.liters,
    fuelDelta: s.freightRateSnapshots.fuelDelta,
    sharePct: s.freightRateSnapshots.sharePct,
    heSo: s.freightRateSnapshots.heSo,
    surchargeRaw: s.freightRateSnapshots.surchargeRaw,
    formulaText: s.freightRateSnapshots.formulaText,
  }).from(s.freightRateSnapshots)
    .where(and(
      eq(s.freightRateSnapshots.shipmentId, member.id),
      isNull(s.freightRateSnapshots.tripId),
    ))
    .orderBy(asc(s.freightRateSnapshots.id));
  let cursor = rows.length - 1;
  while (cursor >= 0 && isRevGroupNote(rows[cursor]!.formulaText)) cursor -= 1;
  // Tail is already the lot's own money — history stays as it is.
  if (cursor === rows.length - 1) return;
  const pre = cursor >= 0 ? rows[cursor]! : null;
  if (pre == null) {
    // No pre-merge row at all: the lot read "Chưa xác định"; a snapshot
    // cannot hold null, so the zero is re-cited as awaiting re-pricing
    // (D02: a computed zero is a value and must carry its reason).
    await insertRevMergeSnapshot(tx, member.id, 0, REV_LOT_AWAITING_REPRICE_REASON);
    return;
  }
  // Re-materialize the pre-merge snapshot — money AND trace ids AND its
  // frozen prose — so the reader rebuilds the pre-merge face (a zero-trace
  // copy would print the wrong "thiếu điều khoản cước" hint). Snapshot rows
  // always carry concrete amounts (the writers never store nulls) and the
  // channel's `source` is not persisted, so 'AUTO' is the house default here.
  await persistFreightRateSnapshot({
    freight: Number(pre.freightAmount),
    surcharge: Number(pre.surchargeAmount),
    total: Number(pre.totalAmount),
    fuelDelta: Number(pre.fuelDelta),
    fuelPricePeriodId: pre.fuelPricePeriodId,
    rateTermsId: pre.rateTermsId,
    pricingTableId: pre.pricingTableId,
    fuelNormId: pre.fuelNormId,
    billedKm: Number(pre.billedKm),
    liters: Number(pre.liters),
    sharePct: Number(pre.sharePct),
    source: 'AUTO',
    formula: 'Tách nhóm — trở về cước thu trước ghép',
    ...(pre.heSo != null ? { heSo: Number(pre.heSo) } : {}),
    ...(pre.surchargeRaw != null ? { surchargeRaw: Number(pre.surchargeRaw) } : {}),
    ...(pre.formulaText != null ? { formulaText: pre.formulaText } : {}),
  }, {
    shipmentId: member.id,
    tripId: null,
    executor: tx,
  });
}

/**
 * A single MEMBER (order > 1) leaving a REV group ("unmerge 1 lô về riêng",
 * spec 23/10): its 0₫ merge state is re-cited as awaiting per-lot re-pricing
 * (CUS picks the lot's own loại xe / giá cước qua per-lot outputs), or — a
 * 21/10-era member still carrying its own non-zero cước — kept with the
 * per-lot marker. A group note citing the dead group is never left stale;
 * an operator's own note is untouched.
 */
async function restateRevLeaverMoney(
  tx: Tx,
  member: ShipmentRow,
  trip: LiveTripFacts | null,
  actor: LclGroupActor,
): Promise<void> {
  if (trip != null) {
    const reason = trip.revenueOverrideReason;
    if (reason == null || !isRevGroupNote(reason)) return;
    const isZero = trip.revenue == null || Number(trip.revenue) === 0;
    await upsertTripFinancialState(tx, trip.tripId, {
      revenuePreGroup: null,
      revenuePreGroupCaptured: false,
      revenueOverriddenBy: actor.userId,
      revenueOverriddenAt: new Date(),
      revenueOverrideReason: isZero ? REV_LOT_AWAITING_REPRICE_REASON : REV_LOT_OWN_CUOC_REASON,
    });
    return;
  }

  const rows = await tx.select({
    totalAmount: s.freightRateSnapshots.totalAmount,
    formulaText: s.freightRateSnapshots.formulaText,
  }).from(s.freightRateSnapshots)
    .where(and(
      eq(s.freightRateSnapshots.shipmentId, member.id),
      isNull(s.freightRateSnapshots.tripId),
    ))
    .orderBy(asc(s.freightRateSnapshots.id));
  const tail = rows.at(-1);
  if (tail == null || !isRevGroupNote(tail.formulaText)) return;
  const amount = Number(tail.totalAmount);
  await insertRevMergeSnapshot(
    tx,
    member.id,
    amount,
    amount === 0 ? REV_LOT_AWAITING_REPRICE_REASON : REV_LOT_OWN_CUOC_REASON,
  );
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
  input: Pick<AssignLclCostGroupInput, 'carrierId' | 'carrierType'>,
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
 * FB-092 — dispatch "Gán xe nhóm" (COST dimension). Spec 23/10: the popup is
 * exactly 4 fields — Loại xe tính cước trả ĐV · Nhà xe · BKS thực · Cước trả
 * ĐVVC — and the ĐV flow NEVER writes BKS báo khách (CUS-only concept).
 *
 * Sourcing rule (FB-090/161026232309): a truck-tonnage class is 100% xe ngoài,
 * so its BKS thực must NOT belong to the internal fleet and the group's nhà xe
 * (nhà thầu) is the vehicle source; container classes accept the SilverSea
 * internal fleet OR a nhà thầu.
 *
 * Money (161026232319/161026232329, spec 23/10): Lô 1 carries 100% of the
 * cước trả ĐVVC — the manual entry when dispatch typed one (kept on
 * `costGroupFreightManual` so it survives to trip issuance), else the carrier
 * price board for the lane — while members 2..N are zeroed. In an
 * internal-fleet container group the driver's road money (lương chuyến + tiền
 * đường) is counted once too: it stays on Lô 1 and members 2..N shed it.
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
    // REQ-19 depth audit — the tải trọng half of "cước hàng lẻ dựa trên trọng
    // tải tấn của xe": Σ the members' known cargoWeightKg against the chosen
    // class' tonnage. Advisory fact for the response + audit trail only —
    // the money law stays the spec's board price (Lô 1 = 100%, members 0₫).
    const cargoFit = assessLclCargoFit({
      isContainer: vehicleClass.isContainer,
      vehicleClassCode: vehicleClass.code,
      cargoWeightKg: ordered.map((row) => (row.cargoWeightKg != null ? Number(row.cargoWeightKg) : null)),
    });
    const tripFacts = await loadLiveTripFactsByShipment(tx, ordered.map((row) => row.id));
    await assertMergeableMoney(tx, ordered, tripFacts);

    const groupId = randomUUID();
    const now = new Date();
    let principalFreight: { amount: string; source: 'MANUAL' | 'PRICE_BOARD' } | null = null;
    for (const [index, row] of ordered.entries()) {
      // The cost-group patch carries ONLY cost-side columns (BKS báo khách is
      // never written here — lcl-grouping-law.ts pins the independence).
      await tx.update(s.shipments).set(costGroupMemberPatch({
        groupId,
        order: index + 1,
        actualTruckNo,
        costVehicleClassId: vehicleClass.id,
        // The manual "Cước trả ĐVVC" lives on Lô 1 only: sticky override for
        // the issuance hook; members carry no money at all.
        costGroupFreightManual: index === 0 ? (input.freightCost != null ? String(input.freightCost) : null) : null,
        version: row.version + 1,
        updatedBy: actor.userId,
        now,
      })).where(eq(s.shipments.id, row.id));

      const trip = tripFacts.get(row.id);
      if (index === 0) {
        // The lane's own source rides Lô 1's trip (the internal fleet pays a
        // SilverSea driver; an outside nhà xe does not) alongside its 100%
        // cước trả ĐVVC — manual entry wins, else the price board.
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
      carrierType: carrier.carrierType,
      carrierId: carrier.carrierId,
      carrierVehicleId: carrier.carrierVehicleId,
      principalFreight,
      cargoFit,
      driverMoneyZeroedForMembers: ownContainerGroup,
      members: ordered.map((row, index) => ({ shipmentId: row.id, order: index + 1 })),
    });

    return {
      groupId,
      memberCount: ordered.length,
      cargoFit,
      members: ordered.map((row, index) => ({
        shipmentId: row.id,
        order: index + 1,
        reference: lotReference(row),
      })),
    };
  });
}

/**
 * Spec 23/10 (261023110000) — SỬA 4 trường của một nhóm ĐV đã gán ("API gán
 * nhóm ĐV THÊM/SỬA"). Membership is fixed; this is a true PARTIAL update: an
 * omitted field KEEPS its current value (review H1 — a one-field payload must
 * never wipe the Nhà xe identity or the money). `freightCost` is 3-state:
 * number = manual override, `null` = BLANK ⇒ auto-trace the carrier board,
 * omitted = money untouched. BKS báo khách is never touched (CUS-only
 * concept).
 */
export async function updateLclCostGroup(
  input: UpdateLclCostGroupInput,
  actor: LclGroupActor,
): Promise<LclGroupAssignResult> {
  return db.transaction(async (tx) => {
    const members = await lockGroupMembers(tx, 'COST', input.groupId);
    if (members.length === 0) {
      throw new ApiError(404, 'Không tìm thấy nhóm ghép trả ĐV');
    }
    const tripFacts = await loadLiveTripFactsByShipment(tx, members.map((row) => row.id));
    await assertGroupMutable(tx, members, tripFacts);

    const principal = members[0]!;
    const vehicleClass = input.vehicleSizeClassId != null
      ? await loadVehicleClass(tx, input.vehicleSizeClassId)
      : await loadVehicleClass(tx, principal.costVehicleClassId ?? 0);
    const actualTruckNo = (input.actualTruckNo ?? principal.actualTruckNo ?? '').trim();
    if (actualTruckNo === '') {
      throw new ApiError(400, 'Thiếu BKS thực của nhóm — truyền BKS thực khi sửa');
    }

    const [internalTruck] = await tx.select({ id: s.trucks.id })
      .from(s.trucks)
      .where(eq(s.trucks.licensePlate, actualTruckNo))
      .limit(1);
    if (lclVehicleSourcingRule(vehicleClass.isContainer) === LclVehicleSourcing.EXTERNAL_ONLY && internalTruck) {
      throw new ApiError(400, `Hàng lẻ xe tải 100% xe ngoài — BKS ${actualTruckNo} là xe nội bộ, chọn BKS nhà xe`);
    }
    // Review H1 — omitted source KEEPS the group's persisted Nhà xe identity
    // (the "phân bổ xe" channel); only an explicit carrierId/carrierType
    // re-resolves it.
    let carrier: LclCostCarrier;
    if (input.carrierId != null || input.carrierType != null) {
      carrier = await resolveLclCostCarrier(tx, input, vehicleClass, actualTruckNo, internalTruck?.id ?? null);
    } else {
      const [assignedFulfillment] = await tx.select({
        plannedCarrierType: s.shipmentFulfillments.plannedCarrierType,
        plannedExternalCarrierId: s.shipmentFulfillments.plannedExternalCarrierId,
      }).from(s.shipmentFulfillments)
        .where(and(
          inArray(s.shipmentFulfillments.shipmentId, members.map((row) => row.id)),
          isNull(s.shipmentFulfillments.canceledAt),
          isNotNull(s.shipmentFulfillments.plannedCarrierType),
        ))
        .orderBy(asc(s.shipmentFulfillments.id))
        .limit(1);
      carrier = assignedFulfillment?.plannedExternalCarrierId != null
        ? await resolveLclCostCarrier(
          tx, { carrierId: assignedFulfillment.plannedExternalCarrierId },
          vehicleClass, actualTruckNo, internalTruck?.id ?? null,
        )
        : assignedFulfillment?.plannedCarrierType === 'OWN'
          ? { carrierType: 'OWN' as const, carrierId: null, supplierId: null, carrierVehicleId: null }
          : await resolveLclCostCarrier(tx, {}, vehicleClass, actualTruckNo, internalTruck?.id ?? null);
    }
    const ownContainerGroup = carrier.carrierType === 'OWN' && vehicleClass.isContainer;

    // 3-state money: only `null`/number touch the money (auto re-trace /
    // manual override); omitted leaves Lô 1's money AND the members' 0₫
    // exactly as they are.
    const moneyChanged = input.freightCost !== undefined;
    const now = new Date();
    let principalFreight: { amount: string; source: 'MANUAL' | 'PRICE_BOARD' } | null = null;
    for (const [index, row] of members.entries()) {
      await tx.update(s.shipments).set(costGroupMemberPatch({
        groupId: input.groupId,
        order: row.costGroupOrder ?? index + 1,
        actualTruckNo,
        costVehicleClassId: vehicleClass.id,
        ...(moneyChanged
          ? { costGroupFreightManual: index === 0 && input.freightCost != null ? String(input.freightCost) : null }
          : {}),
        version: row.version + 1,
        updatedBy: actor.userId,
        now,
      })).where(eq(s.shipments.id, row.id));

      const trip = tripFacts.get(row.id);
      if (index === 0) {
        if (trip) await upsertTripCarrierInfo(tx, trip.tripId, { carrierType: carrier.carrierType });
        if (moneyChanged) {
          principalFreight = await applyPrincipalCostFreight(tx, {
            row,
            trip: trip ?? null,
            vehicleClassId: vehicleClass.id,
            carrier,
            manualFreightCost: input.freightCost ?? undefined,
          });
        }
        continue;
      }
      if (!trip || !moneyChanged) continue;
      await upsertTripCarrierInfo(tx, trip.tripId, {
        carrierType: carrier.carrierType,
        externalFreightCost: '0',
      });
      if (ownContainerGroup) {
        await zeroMemberDriverMoney(tx, trip.tripId);
      }
    }

    await persistLclCostCarrier(tx, members.map((row) => row.id), carrier, actualTruckNo);

    await auditGroupChange(tx, actor, AuditEvent.SHIPMENT_UPDATED, principal, {
      dimension: 'COST',
      action: 'cost-group-update',
      groupId: input.groupId,
      memberCount: members.length,
      vehicleClassCode: vehicleClass.code,
      actualTruckNo,
      carrierType: carrier.carrierType,
      carrierId: carrier.carrierId,
      carrierVehicleId: carrier.carrierVehicleId,
      principalFreight,
      members: members.map((row, index) => ({ shipmentId: row.id, order: index + 1 })),
    });

    return {
      groupId: input.groupId,
      memberCount: members.length,
      members: members.map((row, index) => ({
        shipmentId: row.id,
        order: row.costGroupOrder ?? index + 1,
        reference: lotReference(row),
      })),
    };
  });
}

/**
 * FB-093 — CUS "Ghép cước thu khách" (REV dimension). Spec 23/10: only
 * same-customer lots may share a bill (khác KH ⇒ 400 with a per-lot
 * breakdown), the group receives Loại xe thu nhóm + BKS báo khách chung +
 * Cước thu Lô 1 (blank = auto bảng giá thu khách; nhập tay = override), and
 * the money law of an ACTIVELY merged group is 100%/0₫: Lô 1 carries the
 * whole cước thu; members 2..N are 0₫ stamped/tagged `LCL_REV_MERGE_TAG`.
 *
 * Blank `billingTruckNo` leaves every lot's own value untouched — a blank lot
 * reports the ĐV-assigned BKS thực through the read-side fallback
 * (`effectiveBillingPlate`). A lane miss on Lô 1 keeps its current money
 * (MANUAL semantics) — never a fabricated 0₫ (D02).
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

    // Spec 23/10 §4.2 — "Chỉ cho phép tích gộp các lô của cùng 1 Khách hàng".
    const conflictRows = rows.map((row) => ({ id: row.id, customerId: row.customerId, reference: lotReference(row) }));
    if (findRevCustomerConflict(conflictRows) != null) {
      const customerIds = Array.from(new Set(rows.map((row) => row.customerId).filter((id): id is number => id != null)));
      const customerRows = customerIds.length > 0
        ? await tx.select({ id: s.customers.id, name: s.customers.name })
            .from(s.customers)
            .where(inArray(s.customers.id, customerIds))
        : [];
      assertSameRevCustomer(conflictRows, new Map(customerRows.map((c) => [c.id, c.name])));
    }

    const byId = new Map(rows.map((row) => [row.id, row]));
    const ordered = input.shipmentIds.map((id) => byId.get(id)!);
    const tripFacts = await loadLiveTripFactsByShipment(tx, ordered.map((row) => row.id));
    await assertMergeableMoney(tx, ordered, tripFacts);

    const groupId = randomUUID();
    const principalRef = lotReference(ordered[0]!);
    // BKS báo khách (chung cho nhóm): explicit input is stamped onto every
    // member; blank leaves per-lot values alone (blank ⇒ BKS thực fallback at
    // read time — the ĐV identity is never copied into the CUS field here).
    const billingTruckNo = input.billingTruckNo?.trim() || null;

    // Spec 23/10 — 100%/0₫ inside the merged group: Lô 1 = the group's whole
    // cước thu (manual "Cước thu Lô 1" wins, else the customer × route ×
    // class lane price at Lô 1's delivery day); members 2..N = 0₫ citing
    // `LCL_REV_MERGE_TAG` (D02: a computed zero keeps its reason).
    const principal = ordered[0]!;
    const now = new Date();
    for (const [index, row] of ordered.entries()) {
      await tx.update(s.shipments).set(revGroupMemberPatch({
        groupId,
        order: index + 1,
        revVehicleClassId: vehicleClass.id,
        ...(billingTruckNo != null ? { billingTruckNo } : {}),
        version: row.version + 1,
        updatedBy: actor.userId,
        now,
      })).where(eq(s.shipments.id, row.id));

      const trip = tripFacts.get(row.id);
      if (index > 0) {
        if (trip) {
          await upsertTripFinancialState(tx, trip.tripId, {
            revenue: '0',
            revenueOriginal: trip.revenueOriginal ?? trip.revenue ?? '0',
            // Review C1 — "trạng thái trước ghép" capture: whatever the lot
            // read before this merge (per-lot price, M2.1 edit, or NULL), so
            // "Tách nhóm" restores exactly it.
            revenuePreGroup: trip.revenue,
            revenuePreGroupCaptured: true,
            revenueOverriddenBy: actor.userId,
            revenueOverriddenAt: now,
            revenueOverrideReason: LCL_REV_MERGE_TAG,
          });
        } else {
          await insertRevMergeSnapshot(tx, row.id, 0, `${LCL_REV_MERGE_TAG} — lô ghép giữ 0₫ cước thu (chưa phân bổ xe)`);
        }
        continue;
      }

      const price = input.freightRevenue == null
        && principal.customerId != null && principal.routeId != null && principal.expectedDeliveryDate != null
        ? await resolveCustomerVehicleClassPrice({
          customerId: principal.customerId,
          routeId: principal.routeId,
          vehicleSizeClassId: vehicleClass.id,
          date: principal.expectedDeliveryDate,
        })
        : null;
      const amount = input.freightRevenue ?? (price != null ? price.price : null);
      if (amount == null) {
        // Lane miss and no manual: Lô 1 keeps its current money (MANUAL
        // semantics) but still receives the group stamp so F-2 cites why.
        if (trip) {
          await upsertTripFinancialState(tx, trip.tripId, {
            revenuePreGroup: trip.revenue,
            revenuePreGroupCaptured: true,
            revenueOverriddenBy: actor.userId,
            revenueOverriddenAt: now,
            revenueOverrideReason: `Ghép cước thu khách — Lô 1 giữ 100% cước thu nhóm (${vehicleClass.code})`,
          });
        } else {
          // Review L1 — a trip-less Lô 1 on a lane miss re-cites its current
          // snapshot under the group note (money kept, reason fresh); a lot
          // with no snapshot at all writes nothing (never a fabricated 0₫).
          const current = await latestShipmentLevelSnapshotAmount(tx, row.id);
          if (current != null) {
            await insertRevMergeSnapshot(tx, row.id, current, `Ghép cước thu khách — Lô 1 giữ 100% cước thu nhóm (${vehicleClass.code})`);
          }
        }
        continue;
      }
      const note = input.freightRevenue != null
        ? `Ghép cước thu khách — Lô 1 giữ 100% cước thu nhóm (giá nhập tay, ${vehicleClass.code})`
        : `Ghép cước thu khách — Lô 1 giữ 100% cước thu nhóm (bảng giá khách × tuyến × ${vehicleClass.code}, ngày ${principal.expectedDeliveryDate})`;
      if (trip) {
        await upsertTripFinancialState(tx, trip.tripId, {
          revenue: String(amount),
          revenueOriginal: trip.revenueOriginal ?? trip.revenue ?? '0',
          revenuePreGroup: trip.revenue,
          revenuePreGroupCaptured: true,
          revenueOverriddenBy: actor.userId,
          revenueOverriddenAt: now,
          revenueOverrideReason: note,
        });
      } else {
        await insertRevMergeSnapshot(tx, row.id, amount, note);
      }
    }

    await auditGroupChange(tx, actor, AuditEvent.SHIPMENT_LCL_REV_GROUP_MERGED, ordered[0]!, {
      dimension: 'REV',
      groupId,
      memberCount: ordered.length,
      vehicleClassCode: vehicleClass.code,
      customerId: principal.customerId,
      principalRef,
      billingTruckNo: billingTruckNo ?? undefined,
      freightRevenue: input.freightRevenue != null ? String(input.freightRevenue) : null,
      members: ordered.map((row, index) => ({
        shipmentId: row.id,
        order: index + 1,
        ...(index > 0 ? { revMergeTag: LCL_REV_MERGE_TAG } : {}),
      })),
    });

    return {
      groupId,
      memberCount: ordered.length,
      members: ordered.map((row, index) => ({
        shipmentId: row.id,
        order: index + 1,
        reference: lotReference(row),
        revMergeTag: index > 0 ? LCL_REV_MERGE_TAG : null,
      })),
    };
  });
}

/**
 * 161026232349 (DEV SPEC Hàng lẻ §II.3.2 — "Trường hợp 1 · Thu riêng từng lô")
 * + spec 23/10 §4.1 — the per-lot CUS outputs of ONE lot WITHOUT grouping it:
 * Loại xe thu khách and/or Giá cước thu khách (auto tra bảng giá theo loại +
 * ngày; nhập tay = override). BKS báo khách rides `updateLclGroupTruck` (same
 * per-lot concept, one quick-edit command).
 *
 * Money law — the SAME channel the money boards already read, never a
 * parallel one (revenue-override-read.service's qualification: an LCL lot
 * that is REV-grouped OR whose live trip carries an override stamp):
 *   live trip ⇒ the lot's trip_financial_state.revenue is set to the written
 *   amount and stamped with the override markers (so the CUS board, the Kế
 *   toán board and the customer-debt report all read it — no board changes);
 *   no live trip ⇒ the merge path's shipment-level freight snapshot grain
 *   (insertRevMergeSnapshot, card 161026204709).
 * Neither `revGroupId` nor any cước TRẢ / ĐV field is touched here.
 *
 * A lane miss with no manual price writes NO money at all — the class still
 * saves, and CƯỚC VẬN TẢI (AUTO) stays "Chưa xác định" instead of a
 * fabricated 0₫ (D02 law).
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

    const vehicleClass = input.vehicleSizeClassId != null
      ? await loadVehicleClass(tx, input.vehicleSizeClassId)
      : row.revVehicleClassId != null
        ? await loadVehicleClass(tx, row.revVehicleClassId)
        : null;
    const tripFacts = await loadLiveTripFactsByShipment(tx, [row.id]);
    const trip = tripFacts.get(row.id);
    if (trip && trip.status === 'COMPLETED') {
      throw new ApiError(409, `Lô ${lotReference(row)} đã hoàn thành chuyến — không đổi loại xe/giá cước thu được nữa`);
    }

    if (input.vehicleSizeClassId != null && vehicleClass != null) {
      await tx.update(s.shipments).set({
        revVehicleClassId: vehicleClass.id,
        version: row.version + 1,
        updatedBy: actor.userId,
        updatedAt: new Date(),
      }).where(eq(s.shipments.id, row.id));
    }

    // The lane needs the customer (the lot's own), the route and a date to
    // price against — the merge path's own key. A manual price skips the
    // trace entirely: "nhập tay = lấy theo giá thỏa thuận".
    const laneDate = row.expectedDeliveryDate;
    const price = input.freightRevenue == null
      && vehicleClass != null
      && row.customerId != null && row.routeId != null && laneDate != null
      ? await resolveCustomerVehicleClassPrice({
        customerId: row.customerId,
        routeId: row.routeId,
        vehicleSizeClassId: vehicleClass.id,
        date: laneDate,
      })
      : null;
    const amount = input.freightRevenue ?? (price != null ? price.price : null);
    const reason = input.freightRevenue != null
      ? 'Chọn giá cước thu khách — giá nhập tay (thỏa thuận với khách)'
      : vehicleClass != null
        ? `Chọn loại xe tính cước thu khách — Xe ${vehicleClass.code}`
        : null;

    if (amount == null) {
      // Lane miss and no manual: the class saves (CUS fixes the price board
      // later) while the money column stays "Chưa xác định".
      await auditGroupChange(tx, actor, AuditEvent.SHIPMENT_UPDATED, row, {
        dimension: 'REV',
        action: 'rev-class-single-lot',
        vehicleSizeClassId: vehicleClass?.id ?? null,
        vehicleClassCode: vehicleClass?.code ?? null,
        channel: 'NONE',
        freightAuto: null,
        freightManual: input.freightRevenue != null ? String(input.freightRevenue) : null,
      });
      return {
        shipmentId: row.id,
        reference: lotReference(row),
        vehicleSizeClassId: vehicleClass?.id ?? null,
        vehicleClassCode: vehicleClass?.code ?? null,
        freightAuto: null,
        freightManual: input.freightRevenue != null ? String(input.freightRevenue) : null,
        freight: null,
        channel: 'NONE',
        reason: null,
      };
    }

    const snapshotNote = input.freightRevenue != null
      ? 'Chọn giá cước thu khách — giá nhập tay (thỏa thuận với khách)'
      : `Chọn loại xe tính cước thu khách — 100% bảng giá khách × tuyến × ${vehicleClass?.code}, ngày ${laneDate}`;
    if (trip) {
      const previous = trip.revenueOriginal ?? trip.revenue ?? '0';
      await upsertTripFinancialState(tx, trip.tripId, {
        revenue: String(amount),
        revenueOriginal: previous,
        revenueOverriddenBy: actor.userId,
        revenueOverriddenAt: new Date(),
        revenueOverrideReason: reason ?? snapshotNote,
      });
    } else {
      await insertRevMergeSnapshot(tx, row.id, amount, snapshotNote);
    }

    await auditGroupChange(tx, actor, AuditEvent.SHIPMENT_UPDATED, row, {
      dimension: 'REV',
      action: 'rev-class-single-lot',
      vehicleSizeClassId: vehicleClass?.id ?? null,
      vehicleClassCode: vehicleClass?.code ?? null,
      channel: trip ? 'TRIP' : 'SNAPSHOT',
      freightAuto: price != null ? price.price : null,
      freightManual: input.freightRevenue != null ? String(input.freightRevenue) : null,
      freight: String(amount),
    });

    return {
      shipmentId: row.id,
      reference: lotReference(row),
      vehicleSizeClassId: vehicleClass?.id ?? null,
      vehicleClassCode: vehicleClass?.code ?? null,
      freightAuto: price != null ? String(price.price) : null,
      freightManual: input.freightRevenue != null ? String(input.freightRevenue) : null,
      freight: String(amount),
      channel: trip ? 'TRIP' : 'SNAPSHOT',
      reason,
    };
  });
}

/**
 * FB-093 — quick-edit the BKS pair from the settlement screen.
 *
 * The two plates have different scopes (card 181026145000, spec 23/10):
 *   - BKS thực (actualTruckNo) is the COST group's shared identity — one
 *     physical truck runs the whole group, so an edit rewrites every live
 *     member (the lot alone when ungrouped);
 *   - BKS báo khách (billingTruckNo) is the CUS per-lot output — an edit
 *     touches ONLY the named lot, and `null` clears it (BLANK ⇒ the lot
 *     reports the ĐV-assigned BKS thực via `effectiveBillingPlate`). The
 *     rev group's shared value is set once at merge time; divergence
 *     afterwards is CUS's deliberate per-lot choice.
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
    if (input.actualTruckNo === undefined && input.billingTruckNo === undefined) {
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
    // bump versions of siblings it did not touch. `billingTruckNo: null` is
    // a CLEAR (BLANK ⇒ BKS thực fallback), not "untouched".
    const touched = new Map<number, ShipmentRow>();
    if (input.actualTruckNo != null) {
      for (const target of groupTargets) touched.set(target.id, target);
    }
    if (input.billingTruckNo !== undefined) touched.set(row.id, row);

    const updatedIds: number[] = [];
    for (const target of touched.values()) {
      const patch: Partial<typeof s.shipments.$inferInsert> = {
        updatedBy: actor.userId,
        updatedAt: new Date(),
      };
      if (input.actualTruckNo != null) patch.actualTruckNo = input.actualTruckNo;
      if (input.billingTruckNo !== undefined && target.id === row.id) {
        patch.billingTruckNo = input.billingTruckNo?.trim() || null;
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
      // null is a real value here: it records the CUS clearing the BKS báo
      // khách (BLANK ⇒ BKS thực fallback).
      billingTruckNo: input.billingTruckNo !== undefined ? input.billingTruckNo?.trim() || null : undefined,
    });
    return { updatedShipmentIds: updatedIds };
  });
}
