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
 * The promote-on-unmerge safety law (FB-095) lands on this same service.
 */
import { and, asc, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db, type Tx } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import { lclVehicleSourcingRule, LclVehicleSourcing } from '@tingting/shared';
import type {
  AssignLclCostGroupInput,
  LclGroupDimension,
  MergeLclRevGroupInput,
  UpdateLclTruckInput,
} from '@tingting/shared';
import { AuditEvent } from './audit-types';
import { persistAuditInTransaction } from './audit.service';
import { assertShipmentAccountingUnlocked } from './shipment-accounting-lock-reads.service';
import { upsertTripCarrierInfo, upsertTripFinancialState } from './trip-composite.service';
import { resolveCustomerVehicleClassPrice } from './pricing.service';

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

type ShipmentRow = typeof s.shipments.$inferSelect;

/** Live-trip facts the money steps need, keyed by shipmentId. */
interface LiveTripFacts {
  tripId: number;
  status: string;
  externalFreightCost: string | null;
  revenue: string | null;
  revenueOriginal: string | null;
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
    externalFreightCost: s.tripCarrierInfo.externalFreightCost,
    revenue: s.tripFinancialState.revenue,
    revenueOriginal: s.tripFinancialState.revenueOriginal,
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
        externalFreightCost: row.externalFreightCost,
        revenue: row.revenue,
        revenueOriginal: row.revenueOriginal,
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

async function loadVehicleClass(tx: Tx, vehicleSizeClassId: number) {
  const [vehicleClass] = await tx.select().from(s.vehicleSizeClasses)
    .where(and(eq(s.vehicleSizeClasses.id, vehicleSizeClassId), isNull(s.vehicleSizeClasses.deletedAt)))
    .limit(1);
  if (!vehicleClass) {
    throw new ApiError(404, 'Loại xe tính cước không tồn tại trong danh mục');
  }
  return vehicleClass;
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

/**
 * FB-092 — dispatch "Gán xe nhóm" (COST dimension).
 *
 * Sourcing rule (FB-090): a truck-tonnage class is 100% xe ngoài, so its BKS
 * thực must NOT belong to the internal fleet; container classes accept both.
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

    if (lclVehicleSourcingRule(vehicleClass.isContainer) === LclVehicleSourcing.EXTERNAL_ONLY) {
      const [internalTruck] = await tx.select({ id: s.trucks.id })
        .from(s.trucks)
        .where(eq(s.trucks.licensePlate, actualTruckNo))
        .limit(1);
      if (internalTruck) {
        throw new ApiError(400, `Hàng lẻ xe tải 100% xe ngoài — BKS ${actualTruckNo} là xe nội bộ, chọn BKS nhà xe`);
      }
    }

    // Selection order becomes group order: index 0 = Lô 1 (principal).
    const byId = new Map(rows.map((row) => [row.id, row]));
    const ordered = input.shipmentIds.map((id) => byId.get(id)!);
    const tripFacts = await loadLiveTripFactsByShipment(tx, ordered.map((row) => row.id));
    await assertMergeableMoney(tx, ordered, tripFacts);

    const groupId = randomUUID();
    for (const [index, row] of ordered.entries()) {
      await tx.update(s.shipments).set({
        costGroupId: groupId,
        costGroupOrder: index + 1,
        actualTruckNo,
        billingTruckNo,
        costVehicleClassId: vehicleClass.id,
        version: row.version + 1,
        updatedBy: actor.userId,
        updatedAt: new Date(),
      }).where(eq(s.shipments.id, row.id));

      // "Nhảy tiền" — members 2..N stop paying the vendor: their live trip's
      // external freight cost is zeroed. Lô 1 keeps its value untouched.
      if (index > 0) {
        const trip = tripFacts.get(row.id);
        if (trip) {
          await upsertTripCarrierInfo(tx, trip.tripId, { externalFreightCost: '0' });
        }
      }
    }

    await auditGroupChange(tx, actor, AuditEvent.SHIPMENT_LCL_COST_GROUP_ASSIGNED, ordered[0]!, {
      dimension: 'COST',
      groupId,
      memberCount: ordered.length,
      vehicleClassCode: vehicleClass.code,
      actualTruckNo,
      billingTruckNo,
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
      const names = new Map(rows.map((row) => [row.id, lotReference(row)]));
      throw new ApiError(400, `Chỉ ghép cước thu được các lô của cùng một khách hàng — lô ${input.shipmentIds.map((id) => names.get(id)).join(', ')} khác khách hàng`);
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
      if (!trip) continue;
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
 * FB-093 — quick-edit the BKS pair from the settlement screen. The truck is
 * the COST group's shared identity, so an edit rewrites every live member of
 * the lot's cost group (the lot alone when ungrouped). The rev dimension's
 * billing copy follows only when the caller names it.
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
    const targets = row.costGroupId != null
      ? await tx.select().from(s.shipments)
        .where(and(eq(s.shipments.costGroupId, row.costGroupId), isNull(s.shipments.deletedAt)))
        .orderBy(asc(s.shipments.id))
        .for('update')
      : [row];

    const patch: Partial<typeof s.shipments.$inferInsert> = {
      updatedBy: actor.userId,
      updatedAt: new Date(),
    };
    if (input.actualTruckNo != null) patch.actualTruckNo = input.actualTruckNo;
    if (input.billingTruckNo != null) patch.billingTruckNo = input.billingTruckNo;

    const updatedIds: number[] = [];
    for (const target of targets) {
      await tx.update(s.shipments).set({ ...patch, version: target.version + 1 })
        .where(eq(s.shipments.id, target.id));
      updatedIds.push(target.id);
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
