/**
 * LCL lot grouping (FB-092, DEV SPEC Hàng lẻ §II.2.2).
 *
 * One lô may share a physical truck with other lôs. Two independent money
 * dimensions group independently on `shipments`; this ticket lands the COST
 * one — cước trả ĐV — that dispatch assigns with "Gán xe nhóm": one truck to
 * N lots. Lô 1 (order 1) keeps 100% of the vendor freight; Lô 2..N's live
 * trip external_freight_cost is zeroed ("nhảy tiền").
 *
 * The REV dimension (cước thu khách, FB-093) and the promote-on-unmerge
 * safety law (FB-095) land on this same service.
 */
import { and, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db, type Tx } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import { lclVehicleSourcingRule, LclVehicleSourcing } from '@tingting/shared';
import type { AssignLclCostGroupInput } from '@tingting/shared';
import { AuditEvent } from './audit-types';
import { persistAuditInTransaction } from './audit.service';
import { assertShipmentAccountingUnlocked } from './shipment-accounting-lock-reads.service';
import { upsertTripCarrierInfo } from './trip-composite.service';

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
  }).from(s.trips)
    .leftJoin(s.shipmentFulfillments, eq(s.trips.fulfillmentId, s.shipmentFulfillments.id))
    .leftJoin(s.tripCarrierInfo, eq(s.tripCarrierInfo.tripId, s.trips.id))
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

/** Every selected lot must be a live LCL lot that is not already grouped. */
function assertGroupable(rows: ShipmentRow[], shipmentIds: number[]): void {
  if (rows.length !== shipmentIds.length) {
    throw new ApiError(404, 'Có lô không tồn tại hoặc đã bị xóa trong danh sách ghép');
  }
  for (const row of rows) {
    if (row.cargoMode !== 'LCL') {
      throw new ApiError(400, `Lô ${lotReference(row)} không phải hàng lẻ — chỉ gom được các lô LCL`);
    }
    if (row.costGroupId != null) {
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
    assertGroupable(rows, input.shipmentIds);
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
