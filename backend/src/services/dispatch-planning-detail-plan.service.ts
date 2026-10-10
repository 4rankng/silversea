/**
 * dispatch-planning detail — detail-plan grid, facets, plate/carrier/estimate mutations, zone panels.
 * Extracted from dispatch-planning.service.ts (structure-only split, no behavior change).
 * Layering: utils <- queries <- detail; utils <- commands <- detail (keep acyclic).
 */
import { CUSTOMER_OPERATIONAL_NAME, DispatchActor, INTERNAL_FLEET_CARRIER_NAME, Tx, assertDispatchActor, parseIsoWithZone, toIsoOrNull } from './dispatch-planning-utils.service';
import { loadLiveTripForFulfillment } from './dispatch-planning-commands.service';
import { ApiError } from '../errors';

import { runIdempotent, IDEMPOTENCY_ENDPOINTS } from './idempotency.service';
import { getActiveAssignment } from './truck-driver-assignment.service';
import { assertActorCanAccessShipment } from './shipment-coordination.service';



import { assertShipmentAccountingUnlocked } from './shipment-accounting-lock.service';


import { and, eq, isNotNull, isNull, lt, ne, notInArray, sql } from 'drizzle-orm';
import { canonicalShipmentStatus, TripStatus, type DispatchClassification } from '@tingting/shared';

import * as s from '../db/schema';



import { loadPlannedDriverNames } from './dispatch-planning-detail-plan-read.service';
export {
  normalizeIdList, normalizeTimeMinutes, dispatchDetailRunMinutesSql, dispatchDetailDisplayHour,
  dispatchDetailPriorityOrderSql, listDispatchDetailPlanRows, listDispatchDeliveryPointFacets, listDispatchPortFacets,
} from './dispatch-planning-detail-plan-read.service';
export type { ListDispatchDetailPlanRowsInput } from './dispatch-planning-detail-plan-read.service';
/**
 * One atomic editor save: carrier + vehicle + estimates + classification in a
 * single fulfillment-plus-shipment transaction. The editor always sends every
 * plan field and both row versions, so a partially-stale tab cannot silently
 * erase concurrent work. The lot-level `isCombined` flag is CUS-owned and
 * omitted by the editor; it stays writable here only for existing callers.
 */

export interface UpdateDispatchDetailPlanInput {
  fulfillmentId: number;
  expectedFulfillmentVersion: number;
  expectedShipmentVersion: number;
  carrierType: 'OWN' | 'EXTERNAL';
  externalCarrierId?: number | null;
  truckId?: number | null;
  externalCarrierVehicleId?: number | null;
  plateNumber?: string | null;
  clearVehicle?: boolean;
  plannedRevenue: number | null;
  plannedCarrierCost: number | null;
  /** Per-row Phân loại (Đơn/Kẹp/Kết hợp/Lẻ). The dispatcher's call for cont
   *  rows (Đơn/Kẹp/Kết hợp) since 2026-09-08; CUS sets it at intake and LCL
   *  rows keep Lẻ. Undefined = unchanged. */
  classification?: DispatchClassification;
  /** Lot-level `shipments.is_combined` — CUS owns it (create + quick edit).
   *  Undefined = untouched by this save, which is what the dispatch editor
   *  now always sends: a per-container dispatcher must not rewrite a flag
   *  that spans every container in the lot. */
  isCombined?: boolean;
  /** Card 061026172804 (FB-038 / REQ-04), generalized by card 101026043000:
   *  the dispatcher confirmed the overlap warning — the 409
   *  RIG_OVERLAP_COMPLETED warn-once refusal was acknowledged in the dialog
   *  before this retry. Covers both warn tiers (a COMPLETED trip's window and
   *  a display-slot overlap) and lets the confirmed save proceed. */
  rigOverlapCompletedConfirmed?: boolean;
  /** Driver-facing note (shipments.operational_notes). Undefined = note
   *  untouched by this save. '' clears; null ≡ '' for change detection. */
  operationalNotes?: string | null;
  /** Giờ trả hàng staged on the row (shipment_fulfillments.planned_end_at).
   *  Undefined = untouched by this save; null/'' clears it. Zone-qualified
   *  instant only — parseIsoWithZone 400s on a naive local string. The FE
   *  owns the 'Giờ trả hàng phải sau giờ chạy' cross-field rule. */
  plannedEndAt?: string | null;
  idempotencyKey: string;
  actor: DispatchActor;
}


export interface DispatchDetailPlanMutationResult {
  fulfillmentId: number;
  fulfillmentVersion: number;
  shipmentId: number;
  shipmentVersion: number;
  classification: DispatchClassification;
  isCombined: boolean;
  /** Stored Giờ trả hàng after the save (ISO instant; null when unstaged). */
  plannedEndAt: string | null;
  /** Stored driver-facing note after the save (accountants never reach this
   *  path — the route gate excludes them, matching the read-side mask). */
  operationalNotes: string | null;
  dispatch: {
    carrierType: 'OWN' | 'EXTERNAL';
    carrierName: string | null;
    externalCarrierId: number | null;
    externalCarrierVehicleId: number | null;
    assignedPlate: string | null;
    assignedDriverName: string | null;
    /** True once the trip's driver acknowledged (ORDER_RECEIVED) — locks
     *  reassignment; always false for fulfillment-less rows. */
    driverAccepted: boolean;
  };
  estimates: {
    plannedRevenue: string | null;
    plannedCarrierCost: string | null;
  };
  lotFullyPlated: boolean;
  driverNotified: boolean;
  driverHint: string | null;
}


export interface AssignFulfillmentPlateInput {
  fulfillmentId: number;
  expectedVersion: number;
  truckId?: number | null;
  externalCarrierVehicleId?: number | null;
  plateNumber?: string | null;
  clear?: boolean;
  /** Card 101026043000 — sibling sweep: the same warn-once overlap contract
   *  as the atomic plan save (RIG_OVERLAP_COMPLETED confirm). */
  rigOverlapCompletedConfirmed?: boolean;
  idempotencyKey: string;
  actor: DispatchActor;
}


export interface AssignFulfillmentCarrierInput {
  fulfillmentId: number;
  expectedVersion: number;
  carrierType: 'OWN' | 'EXTERNAL';
  externalCarrierId: number | null;
  idempotencyKey: string;
  actor: DispatchActor;
}

/** Operational revenue/cost estimates; never a ledger or accounting entry. */

export interface UpdateFulfillmentEstimatesInput {
  fulfillmentId: number;
  expectedVersion: number;
  plannedRevenue: number | null;
  plannedCarrierCost: number | null;
  idempotencyKey: string;
  actor: DispatchActor;
}


export interface PlateMutationResult {
  fulfillmentId: number;
  version: number;
  lotFullyPlated: boolean;
  driverNotified: boolean;
  assignedPlate: string | null;
  assignedDriverId: number | null;
  assignedDriverName: string | null;
  driverHint: string | null;
}


export interface CarrierMutationResult {
  fulfillmentId: number;
  version: number;
  carrierType: 'OWN' | 'EXTERNAL';
  externalCarrierId: number | null;
  carrierName: string;
  externalCarrierVehicleId: null;
  assignedPlate: null;
  lotFullyPlated: boolean;
}

// Same display normalization the carrier vehicle catalog uses
// (carrier-fleet-vehicle.service.ts formatPlate): trim, uppercase, collapse
// internal whitespace.


// Same display normalization the carrier vehicle catalog uses
// (carrier-fleet-vehicle.service.ts formatPlate): trim, uppercase, collapse
// internal whitespace.
export function normalizeFreeTextPlate(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, ' ');
}

/**
 * Reassign exactly one ready fulfillment from the detailed vehicle workspace.
 * The master-plan allocation remains the aggregate planning surface; this
 * command only changes the selected operational task and atomically removes
 * its now-incompatible vehicle/plate assignment.
 */

export async function assignFulfillmentCarrierWriteCommand(input: AssignFulfillmentCarrierInput): Promise<CarrierMutationResult & { replayed: boolean }> {
  assertDispatchActor(input.actor);
  const outcome = await runIdempotent<CarrierMutationResult>({
    endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_FULFILLMENT_CARRIER_ASSIGN,
    idempotencyKey: input.idempotencyKey,
    payload: {
      fulfillmentId: input.fulfillmentId,
      expectedVersion: input.expectedVersion,
      carrierType: input.carrierType,
      externalCarrierId: input.externalCarrierId,
    },
    createdBy: input.actor.userId,
    entityType: 'shipment_fulfillments',
    getEntityId: (result) => result.fulfillmentId,
    create: (tx) => assignFulfillmentCarrierInTx(tx, input),
  });
  return { ...outcome.result, replayed: outcome.replayed };
}


export async function assignFulfillmentCarrierInTx(tx: Tx, input: AssignFulfillmentCarrierInput): Promise<CarrierMutationResult> {
  // Read the parent id first, then use the same shipment → fulfillment lock
  // order as dispatch issuance so this mutation cannot deadlock with it.
  const [candidate] = await tx.select({ shipmentId: s.shipmentFulfillments.shipmentId })
    .from(s.shipmentFulfillments)
    .where(and(eq(s.shipmentFulfillments.id, input.fulfillmentId), isNull(s.shipmentFulfillments.canceledAt)))
    .limit(1);
  if (!candidate) throw new ApiError(404, 'Không tìm thấy tác vụ điều xe.');

  const [shipment] = await tx.select().from(s.shipments)
    .where(and(eq(s.shipments.id, candidate.shipmentId), isNull(s.shipments.deletedAt)))
    .for('update')
    .limit(1);
  if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng.');
  await assertActorCanAccessShipment(tx, shipment.id, input.actor, { write: true });
  await assertShipmentAccountingUnlocked(tx, shipment.id);
  // Per-container reassignment: only terminal lot statuses block carrier
  // changes. A partially-dispatched lot keeps its remaining READY rows
  // re-assignable — same stranding risk as the plan-save guard below (the lot
  // flips DISPATCHED when the first container's order is issued), mirroring
  // the 2026-09-05 issuance-side fix in dispatch-planning-commands.service.ts.
  const carrierAssignStatus = canonicalShipmentStatus(shipment.status);
  if (carrierAssignStatus === 'COMPLETED' || carrierAssignStatus === 'CANCELED') {
    throw new ApiError(409, 'Lô hàng đã kết thúc, không thể đổi nhà xe.');
  }

  const [fulfillment] = await tx.select().from(s.shipmentFulfillments)
    .where(and(eq(s.shipmentFulfillments.id, input.fulfillmentId), isNull(s.shipmentFulfillments.canceledAt)))
    .for('update')
    .limit(1);
  if (!fulfillment) throw new ApiError(404, 'Không tìm thấy tác vụ điều xe.');
  if (fulfillment.version !== input.expectedVersion) {
    throw new ApiError(409, 'Tác vụ điều xe đã thay đổi. Vui lòng tải lại.');
  }
  if (await loadLiveTripForFulfillment(tx, fulfillment.id)) {
    throw new ApiError(409, 'Không thể đổi nhà xe sau khi đã phát hành lệnh điều xe.');
  }

  let carrierName = INTERNAL_FLEET_CARRIER_NAME;
  if (input.carrierType === 'OWN') {
    if (input.externalCarrierId != null) throw new ApiError(400, 'Xe nội bộ không dùng mã nhà xe ngoài.');
  } else {
    if (input.externalCarrierId == null) throw new ApiError(400, 'Nhà xe ngoài là bắt buộc.');
    const [carrier] = await tx.select({ id: s.customers.id, name: CUSTOMER_OPERATIONAL_NAME })
      .from(s.customers)
      .where(and(
        eq(s.customers.id, input.externalCarrierId),
        eq(s.customers.isCarrier, true),
        eq(s.customers.status, 'ACTIVE'),
        isNull(s.customers.deletedAt),
      ))
      .limit(1);
    if (!carrier) throw new ApiError(409, 'Nhà xe không còn hiệu lực.');
    carrierName = carrier.name;
  }

  const [updated] = await tx.update(s.shipmentFulfillments).set({
    plannedCarrierType: input.carrierType,
    plannedExternalCarrierId: input.carrierType === 'EXTERNAL' ? input.externalCarrierId : null,
    plannedExternalCarrierVehicleId: null,
    plannedVehiclePlateNumber: null,
    version: fulfillment.version + 1,
    updatedAt: new Date(),
  }).where(and(
    eq(s.shipmentFulfillments.id, fulfillment.id),
    eq(s.shipmentFulfillments.version, fulfillment.version),
  )).returning();
  if (!updated) throw new ApiError(409, 'Tác vụ điều xe đã thay đổi. Vui lòng tải lại.');

  return {
    fulfillmentId: updated.id,
    version: updated.version,
    carrierType: input.carrierType,
    externalCarrierId: input.carrierType === 'EXTERNAL' ? input.externalCarrierId : null,
    carrierName,
    externalCarrierVehicleId: null,
    assignedPlate: null,
    lotFullyPlated: await recomputeLotFullyPlated(tx, shipment.id),
  };
}


export async function assignFulfillmentPlate(input: AssignFulfillmentPlateInput): Promise<PlateMutationResult & { replayed: boolean }> {
  assertDispatchActor(input.actor);
  const outcome = await runIdempotent<PlateMutationResult>({
    endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_FULFILLMENT_PLATE_ASSIGN,
    idempotencyKey: input.idempotencyKey,
    payload: {
      fulfillmentId: input.fulfillmentId,
      expectedVersion: input.expectedVersion,
      truckId: input.truckId ?? null,
      externalCarrierVehicleId: input.externalCarrierVehicleId ?? null,
      plateNumber: input.plateNumber ?? null,
      clear: input.clear === true,
      rigOverlapCompletedConfirmed: input.rigOverlapCompletedConfirmed === true,
    },
    createdBy: input.actor.userId,
    entityType: 'shipment_fulfillments',
    getEntityId: (result) => result.fulfillmentId,
    create: (tx) => assignFulfillmentPlateInTx(tx, input),
  });

  return { ...outcome.result, replayed: outcome.replayed };
}


export interface DispatchVehicleResolution {
  plannedVehiclePlateNumber: string | null;
  plannedExternalCarrierVehicleId: number | null;
  assignedTruckId: number | null;
  assignedDriverId: number | null;
  assignedDriverName: string | null;
  driverHint: string | null;
}

/**
 * Resolve the editor's vehicle selection into fulfillment columns. Shared by
 * the legacy plate endpoint and the atomic plan save. Vehicle ownership is
 * validated against the passed carrier — for the atomic save that is the
 * incoming carrier, so carrier and vehicle can switch together without
 * stranding a stale carrier-vehicle link.
 */

export async function resolveDispatchVehicleAssignment(tx: Tx, args: {
  carrierType: 'OWN' | 'EXTERNAL';
  plannedExternalCarrierId: number | null;
  truckId: number | null;
  externalCarrierVehicleId: number | null;
  plateNumber: string | null;
  clear: boolean;
}): Promise<DispatchVehicleResolution> {
  let plannedVehiclePlateNumber: string | null = null;
  let plannedExternalCarrierVehicleId: number | null = null;
  let assignedTruckId: number | null = null;
  let assignedDriverId: number | null = null;
  let assignedDriverName: string | null = null;
  let driverHint: string | null = null;

  if (args.clear) {
    // Clear path: both carrier types allowed; un-assign everything.
  } else if (args.carrierType === 'OWN') {
    if (args.truckId == null) {
      throw new ApiError(400, 'Xe nội bộ phải chọn biển số từ đội xe công ty.');
    }
    if (args.plateNumber != null || args.externalCarrierVehicleId != null) {
      throw new ApiError(400, 'Nhà xe nội bộ không dùng biển số tự do hoặc xe nhà thầu.');
    }
    const [truck] = await tx.select({
      id: s.trucks.id,
      licensePlate: s.trucks.licensePlate,
      status: s.trucks.status,
      deletedAt: s.trucks.deletedAt,
    }).from(s.trucks).where(eq(s.trucks.id, args.truckId)).limit(1);
    if (!truck || truck.deletedAt || truck.status !== 'ACTIVE') {
      throw new ApiError(409, 'Xe đầu kéo không còn hiệu lực.');
    }
    const assignment = await getActiveAssignment(tx, truck.id);
    plannedVehiclePlateNumber = truck.licensePlate;
    assignedTruckId = truck.id;
    if (assignment) {
      assignedDriverId = assignment.driverId;
      assignedDriverName = assignment.driverName;
      if (assignment.driverUserId == null) driverHint = 'Lái xe chưa có tài khoản đăng nhập.';
    } else {
      driverHint = 'Chưa có lái xe gắn với xe.';
    }
  } else {
    // EXTERNAL: catalog pick, free text, or empty (CUS fills later).
    if (args.externalCarrierVehicleId != null) {
      if (args.plateNumber != null) {
        throw new ApiError(400, 'Chỉ chọn một nguồn biển số: xe nhà thầu hoặc nhập tay.');
      }
      const [vehicle] = await tx.select({
        id: s.carrierFleetVehicles.id,
        carrierId: s.carrierFleetVehicles.carrierId,
        licensePlate: s.carrierFleetVehicles.licensePlate,
        isActive: s.carrierFleetVehicles.isActive,
        deletedAt: s.carrierFleetVehicles.deletedAt,
      }).from(s.carrierFleetVehicles)
        .where(eq(s.carrierFleetVehicles.id, args.externalCarrierVehicleId))
        .limit(1);
      if (!vehicle || vehicle.deletedAt || !vehicle.isActive) {
        throw new ApiError(409, 'Xe nhà thầu không còn hiệu lực.');
      }
      if (args.plannedExternalCarrierId != null && vehicle.carrierId !== args.plannedExternalCarrierId) {
        throw new ApiError(409, 'Xe không thuộc nhà xe được phân công.');
      }
      plannedVehiclePlateNumber = vehicle.licensePlate;
      plannedExternalCarrierVehicleId = vehicle.id;
    } else if (args.plateNumber != null) {
      const normalized = normalizeFreeTextPlate(args.plateNumber);
      const trimmed = args.plateNumber.trim();
      if (trimmed.length < 4 || trimmed.length > 20) {
        throw new ApiError(400, 'Biển số xe không hợp lệ.');
      }
      plannedVehiclePlateNumber = normalized;
      // Registry A (trucks) is the source of truth for external plates: a
      // typed plate links to (or auto-registers into) the carrier's catalog —
      // the list dispatchers manage on /suppliers — so attribution
      // (resolve-carrier) self-heals instead of decaying. Tombstoned plates
      // stay reserved; the plate's UNIQUE column blocks a duplicate insert.
      if (args.plannedExternalCarrierId != null) {
        const plateKey = normalized.replace(/[^A-Z0-9]/g, '');
        const [truckMatch] = await tx.select({ id: s.trucks.id }).from(s.trucks)
          .where(and(
            eq(s.trucks.carrierId, args.plannedExternalCarrierId),
            sql`regexp_replace(upper(${s.trucks.licensePlate}), '[^A-Z0-9]', '', 'g') = ${plateKey}`,
            isNull(s.trucks.deletedAt),
          ))
          .limit(1);
        if (!truckMatch) {
          const [plateOwner] = await tx.select({ id: s.trucks.id }).from(s.trucks)
            .where(sql`regexp_replace(upper(${s.trucks.licensePlate}), '[^A-Z0-9]', '', 'g') = ${plateKey}`)
            .limit(1);
          if (!plateOwner) {
            await tx.insert(s.trucks).values({
              licensePlate: normalized,
              carrierId: args.plannedExternalCarrierId,
              status: 'ACTIVE',
            }).onConflictDoNothing();
          }
        }
        // Legacy B match retained so pre-unification assignments keep
        // resolving their vehicle link.
        const [match] = await tx.select({
          id: s.carrierFleetVehicles.id,
        }).from(s.carrierFleetVehicles)
          .where(and(
            eq(s.carrierFleetVehicles.carrierId, args.plannedExternalCarrierId),
            eq(s.carrierFleetVehicles.normalizedPlate, plateKey),
            isNull(s.carrierFleetVehicles.deletedAt),
          ))
          .limit(1);
        plannedExternalCarrierVehicleId = match?.id ?? null;
      }
    }
    // else: empty assignment (bypass) — plate stays null, allowed for EXTERNAL.
  }

  return {
    plannedVehiclePlateNumber,
    plannedExternalCarrierVehicleId,
    assignedTruckId,
    assignedDriverId,
    assignedDriverName,
    driverHint,
  };
}

export async function assignFulfillmentPlateInTx(tx: Tx, input: AssignFulfillmentPlateInput): Promise<PlateMutationResult> {
  const [fulfillment] = await tx.select().from(s.shipmentFulfillments)
    .where(and(
      eq(s.shipmentFulfillments.id, input.fulfillmentId),
      isNull(s.shipmentFulfillments.canceledAt),
    ))
    .limit(1)
    .for('update');
  if (!fulfillment) throw new ApiError(404, 'Không tìm thấy tác vụ điều xe.');
  if (fulfillment.version !== input.expectedVersion) {
    throw new ApiError(409, 'Tác vụ điều xe đã thay đổi. Vui lòng tải lại.');
  }
  const carrierType = fulfillment.plannedCarrierType;
  if (carrierType !== 'OWN' && carrierType !== 'EXTERNAL') {
    throw new ApiError(409, 'CUS chưa gán nhà xe cho tác vụ này.');
  }

  // Terminal lot statuses block plate writes on this single-field endpoint
  // too — the atomic plan save and the carrier change already reject with
  // 409 "Lô hàng đã kết thúc", and this legacy path accepting the same write
  // on a COMPLETED lot was a guard inconsistency. Deliberately a plain read
  // (no FOR UPDATE): the fulfillment row lock above already serializes this
  // endpoint, and locking the shipment here would invert the carrier path's
  // lock order (shipment → fulfillment) and deadlock the two endpoints.
  const [plateLot] = await tx.select({ status: s.shipments.status })
    .from(s.shipments)
    .where(and(eq(s.shipments.id, fulfillment.shipmentId), isNull(s.shipments.deletedAt)))
    .limit(1);
  if (!plateLot) throw new ApiError(404, 'Không tìm thấy lô hàng.');
  if (canonicalShipmentStatus(plateLot.status) === 'COMPLETED' || canonicalShipmentStatus(plateLot.status) === 'CANCELED') {
    throw new ApiError(409, 'Lô hàng đã kết thúc, không thể gán biển số.');
  }

  await assertShipmentAccountingUnlocked(tx, fulfillment.shipmentId);

  const vehicle = await resolveDispatchVehicleAssignment(tx, {
    carrierType,
    plannedExternalCarrierId: fulfillment.plannedExternalCarrierId,
    truckId: input.truckId ?? null,
    externalCarrierVehicleId: input.externalCarrierVehicleId ?? null,
    plateNumber: input.plateNumber ?? null,
    clear: input.clear === true,
  });

  // Card 101026043000 — sibling sweep: this legacy endpoint assigns a truck
  // to the row's slot too and had NO overlap detection at all (the atomic
  // plan save's guard is the shared owner). Same warn-once contract.
  if (vehicle.plannedVehiclePlateNumber != null && vehicle.plannedVehiclePlateNumber.trim() !== '') {
    const window = await resolvePlanRowWindow(tx, fulfillment);
    if (window != null) {
      await assertPlanRowRigAvailable(tx, {
        fulfillmentId: input.fulfillmentId,
        shipmentId: fulfillment.shipmentId,
        plate: vehicle.plannedVehiclePlateNumber,
        window,
        windowEnd: null,
        confirmOverlap: input.rigOverlapCompletedConfirmed === true,
        classification: fulfillment.dispatchClassification,
      });
    }
  }

  const [updated] = await tx.update(s.shipmentFulfillments).set({
    plannedVehiclePlateNumber: vehicle.plannedVehiclePlateNumber,
    plannedExternalCarrierVehicleId: vehicle.plannedExternalCarrierVehicleId,
    version: fulfillment.version + 1,
    updatedAt: new Date(),
  }).where(and(
    eq(s.shipmentFulfillments.id, fulfillment.id),
    eq(s.shipmentFulfillments.version, fulfillment.version),
  )).returning();
  if (!updated) throw new ApiError(409, 'Tác vụ điều xe đã thay đổi. Vui lòng tải lại.');

  const lotFullyPlated = await recomputeLotFullyPlated(tx, fulfillment.shipmentId);

  // Plate assignment never notifies the driver — dispatch-order issuance
  // (issueOrderCreateOrUpdate) owns the driver notification, so the driver
  // never sees or taps into a job that has no trips row yet.
  return {
    fulfillmentId: fulfillment.id,
    version: updated.version,
    lotFullyPlated,
    driverNotified: false,
    assignedPlate: vehicle.plannedVehiclePlateNumber,
    assignedDriverId: vehicle.assignedDriverId,
    assignedDriverName: vehicle.assignedDriverName,
    driverHint: vehicle.driverHint,
  };
}


export interface FulfillmentEstimatesMutationResult {
  fulfillmentId: number;
  version: number;
  plannedRevenue: string | null;
  plannedCarrierCost: string | null;
}

/**
 * Saves an operational estimate only.  Financial postings stay exclusively in
 * the accounting workflow, and the accounting lock also protects this plan.
 */

export async function updateFulfillmentEstimates(
  input: UpdateFulfillmentEstimatesInput,
): Promise<FulfillmentEstimatesMutationResult & { replayed: boolean }> {
  assertDispatchActor(input.actor);
  const outcome = await runIdempotent<FulfillmentEstimatesMutationResult>({
    endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_FULFILLMENT_ESTIMATES_UPDATE,
    idempotencyKey: input.idempotencyKey,
    payload: {
      fulfillmentId: input.fulfillmentId,
      expectedVersion: input.expectedVersion,
      plannedRevenue: input.plannedRevenue,
      plannedCarrierCost: input.plannedCarrierCost,
    },
    createdBy: input.actor.userId,
    entityType: 'shipment_fulfillments',
    getEntityId: (result) => result.fulfillmentId,
    create: async (tx) => {
      const [fulfillment] = await tx.select().from(s.shipmentFulfillments)
        .where(and(
          eq(s.shipmentFulfillments.id, input.fulfillmentId),
          isNull(s.shipmentFulfillments.canceledAt),
        ))
        .limit(1)
        .for('update');
      if (!fulfillment) throw new ApiError(404, 'Không tìm thấy tác vụ điều xe.');
      if (fulfillment.version !== input.expectedVersion) {
        throw new ApiError(409, 'Tác vụ điều xe đã thay đổi. Vui lòng tải lại.');
      }

      await assertShipmentAccountingUnlocked(tx, fulfillment.shipmentId);
      const [updated] = await tx.update(s.shipmentFulfillments).set({
        plannedRevenue: input.plannedRevenue == null ? null : String(input.plannedRevenue),
        plannedCarrierCost: input.plannedCarrierCost == null ? null : String(input.plannedCarrierCost),
        version: fulfillment.version + 1,
        updatedAt: new Date(),
      }).where(and(
        eq(s.shipmentFulfillments.id, fulfillment.id),
        eq(s.shipmentFulfillments.version, fulfillment.version),
      )).returning();
      if (!updated) throw new ApiError(409, 'Tác vụ điều xe đã thay đổi. Vui lòng tải lại.');
      return {
        fulfillmentId: updated.id,
        version: updated.version,
        plannedRevenue: updated.plannedRevenue,
        plannedCarrierCost: updated.plannedCarrierCost,
      };
    },
  });
  return { ...outcome.result, replayed: outcome.replayed };
}

/**
 * Atomic editor save for one detailed-plan row. Locks shipment then
 * fulfillment (the same order as dispatch issuance, so this cannot deadlock
 * with it), applies the union of the strongest legacy guards, updates both
 * versioned rows in one transaction, and returns the complete row state.
 * Planning saves never notify the driver — dispatch-order issuance
 * (issueOrderCreateOrUpdate) owns the driver notification.
 */

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
 */
interface PlanRowWindow {
  start: Date;
  strong: boolean;
}

async function resolvePlanRowWindow(
  tx: Tx,
  fulfillment: { shipmentId: number; shipmentContainerId: number | null },
): Promise<PlanRowWindow | null> {
  if (fulfillment.shipmentContainerId != null) {
    const [row] = await tx.select({
      appointment: s.shipmentContainers.customerAppointmentAt,
      closingAt: s.shipments.closingAt,
      plannedReturnAt: s.shipments.plannedReturnAt,
    })
      .from(s.shipmentContainers)
      .innerJoin(s.shipments, eq(s.shipments.id, s.shipmentContainers.shipmentId))
      .where(eq(s.shipmentContainers.id, fulfillment.shipmentContainerId))
      .limit(1);
    const start = row?.appointment ?? row?.closingAt ?? row?.plannedReturnAt ?? null;
    return start == null ? null : { start, strong: row?.appointment != null };
  }
  const [lot] = await tx.select({
    closingAt: s.shipments.closingAt,
    plannedReturnAt: s.shipments.plannedReturnAt,
  })
    .from(s.shipments)
    .where(eq(s.shipments.id, fulfillment.shipmentId))
    .limit(1);
  const start = lot?.closingAt ?? lot?.plannedReturnAt ?? null;
  // The lot date IS the LCL row's primary slot (card 061026174603) — full
  // evidence for an LCL row, unlike an FCL fallback.
  return start == null ? null : { start, strong: true };
}

async function assertPlanRowRigAvailable(
  tx: Tx,
  args: {
    fulfillmentId: number;
    /** The saving row's lot. Same-lot plan rows are the lot's own deliberate
     *  rotation (one tractor lifting every container — the lotFullyPlated
     *  flow), never the cross-lot claim the guard's copy names: they warn
     *  once and the confirmed save proceeds. Only a cross-lot claim can pin
     *  the hard tier (generalizes the Kẹp carve-out, card 081026091100). */
    shipmentId: number;
    plate: string;
    window: PlanRowWindow;
    windowEnd: Date | null;
    /** Card 061026172804 (FB-038 / REQ-04) + 101026043000: the dispatcher
     *  confirmed the overlap warning — the confirmed retry may ride a
     *  COMPLETED trip's window or a display-slot (weak-evidence) overlap. */
    confirmOverlap?: boolean;
    /** Card 081026091100: the row's Phân loại. "Kẹp" is 'DOUBLE'
     *  (DISPATCH_CLASSIFICATION_LABELS) — two 20' containers ride ONE mooc, so
     *  the pair's two planned windows on that tractor overlap by construction.
     *  trip-pairing.service.ts already documents that the sequential rules do
     *  not apply to KEP; this guard had no way to know. */
    classification?: DispatchClassification | null;
  },
): Promise<void> {
  const plate = args.plate.trim();
  if (!plate) return;
  // The row's own window: start = its slot; end = the saved Giờ trả hàng,
  // defaulting to an 8-hour shift when unsaved. Card 101026043000: a staged
  // end at/before the start is not a SHORTER occupation — it is an unprovable
  // one, so the card-363 8-hour law covers it. The old `windowEnd ?? +8h`
  // let a zero window silently disprove every scan below.
  const windowStart = args.window.start;
  const degenerateEnd = args.windowEnd != null && args.windowEnd.getTime() <= windowStart.getTime();
  const windowEnd = args.windowEnd != null && !degenerateEnd
    ? args.windowEnd
    : new Date(windowStart.getTime() + 8 * 3600_000);
  // Card 081026091100: a Kẹp row shares the rig with its partner leg ON
  // PURPOSE, so the two pre-dispatch plan rows overlapping on that plate is the
  // arrangement the dispatcher asked for, not a conflict. Only the plan-row
  // scans are skipped — the dispatched-trip scan below still runs, so a Kẹp row
  // is still refused when an unrelated LIVE trip holds that tractor (that is
  // not the pair's own overlap).
  const isKepPairing = args.classification === 'DOUBLE';
  // Pre-dispatch plan rows planned onto the same rig with an overlapping
  // window. A row without its own appointment cannot prove overlap and is
  // skipped rather than guessed into a conflict. Card 363: a row without a
  // saved end is bounded by one 8-hour shift (the same default the saving row
  // uses above) instead of counting as occupying the rig forever.
  const planConflicts = await tx.select({
    id: s.shipmentFulfillments.id,
    shipmentId: s.shipmentFulfillments.shipmentId,
    fallbackSlot: isNull(s.shipmentContainers.customerAppointmentAt),
  })
    .from(s.shipmentFulfillments)
    .innerJoin(s.shipmentContainers, eq(s.shipmentContainers.id, s.shipmentFulfillments.shipmentContainerId))
    .innerJoin(s.shipments, eq(s.shipments.id, s.shipmentFulfillments.shipmentId))
    .where(and(
      ne(s.shipmentFulfillments.id, args.fulfillmentId),
      isNull(s.shipmentFulfillments.canceledAt),
      eq(s.shipmentFulfillments.plannedVehiclePlateNumber, plate),
      // Slot law (card 101026043000): the SAME coalesce the grid renders as
      // the row's time. A row without an explicit appointment whose slot
      // rides the lot fallback is a real claim on the rig — demanding
      // customerAppointmentAt here made exactly those claims invisible and
      // the double-booking saved silently. Card 363: a row without a saved
      // end is bounded by one 8-hour shift (the same default the saving row
      // uses above) instead of counting as occupying the rig forever.
      sql`coalesce(${s.shipmentContainers.customerAppointmentAt}, ${s.shipments.closingAt}, ${s.shipments.plannedReturnAt}) is not null`,
      sql`coalesce(${s.shipmentContainers.customerAppointmentAt}, ${s.shipments.closingAt}, ${s.shipments.plannedReturnAt}) < ${windowEnd.toISOString()}::timestamptz`,
      sql`coalesce(${s.shipmentFulfillments.plannedEndAt}, coalesce(${s.shipmentContainers.customerAppointmentAt}, ${s.shipments.closingAt}, ${s.shipments.plannedReturnAt}) + interval '8 hours') > ${windowStart.toISOString()}::timestamptz`,
      // QA rework 061026172804: a fulfillment whose trip is COMPLETED has
      // released the rig (card 363) — it must fall through to the completed
      // tier's warning below, not raise the generic plan-row block here
      // (the masking the staging QA cut exposed).
      sql`not exists (select 1 from ${s.trips} where ${s.trips.fulfillmentId} = ${s.shipmentFulfillments.id} and ${s.trips.status} = 'COMPLETED' and ${s.trips.deletedAt} is null)`,
    ));
  // Card 061026174603: an LCL row is a plan unit too, but it has no container,
  // so the branch above (which inner-joins shipmentContainers) cannot see it.
  // Without this the same tractor could ride two overlapping LCL rows, or an
  // LCL row and an FCL row — the guard would protect FCL and silently exempt
  // Hàng lẻ. Same overlap rule, same 8-hour default, LCL window from the lot.
  const lclPlanConflicts = await tx.select({ id: s.shipmentFulfillments.id, shipmentId: s.shipmentFulfillments.shipmentId })
    .from(s.shipmentFulfillments)
    .innerJoin(s.shipments, eq(s.shipments.id, s.shipmentFulfillments.shipmentId))
    .where(and(
      ne(s.shipmentFulfillments.id, args.fulfillmentId),
      isNull(s.shipmentFulfillments.canceledAt),
      eq(s.shipmentFulfillments.plannedVehiclePlateNumber, plate),
      eq(s.shipmentFulfillments.fulfillmentType, 'LCL_SHIPMENT'),
      sql`coalesce(${s.shipments.closingAt}, ${s.shipments.plannedReturnAt}) is not null`,
      sql`coalesce(${s.shipments.closingAt}, ${s.shipments.plannedReturnAt}) < ${windowEnd.toISOString()}::timestamptz`,
      sql`coalesce(${s.shipmentFulfillments.plannedEndAt}, coalesce(${s.shipments.closingAt}, ${s.shipments.plannedReturnAt}) + interval '8 hours') > ${windowStart.toISOString()}::timestamptz`,
      // Same released-rig exclusion as the FCL scan above.
      sql`not exists (select 1 from ${s.trips} where ${s.trips.fulfillmentId} = ${s.shipmentFulfillments.id} and ${s.trips.status} = 'COMPLETED' and ${s.trips.deletedAt} is null)`,
    ));
  // Dispatched trips riding the same rig: the plate is the pre-dispatch key,
  // the truck's license plate is the dispatched key — one physical tractor.
  // Card 363: only ACTIVE trips occupy the rig (a COMPLETED trip released it —
  // back-to-back 'chạy gối đầu' assignments were false-blocked), and an
  // open-ended trip is bounded by one 8-hour shift from its start.
  const tripConflicts = await tx.select({ id: s.trips.id, code: s.trips.tripCode })
    .from(s.trips)
    .innerJoin(s.trucks, eq(s.trucks.id, s.trips.truckId))
    .where(and(
      eq(s.trucks.licensePlate, plate),
      notInArray(s.trips.status, [TripStatus.CANCELED, TripStatus.COMPLETED]),
      isNull(s.trips.deletedAt),
      isNotNull(s.trips.plannedStartAt),
      lt(s.trips.plannedStartAt, windowEnd),
      sql`coalesce(${s.trips.plannedEndAt}, ${s.trips.plannedStartAt} + interval '8 hours') > ${windowStart.toISOString()}::timestamptz`,
    ));
  // Card 081026091100: for a Kẹp row only the dispatched-trip scan counts — the
// two plan-row scans describe the pair's own deliberate overlap. Every other
// classification keeps all three.
  // Same-lot plan rows are the Kẹp carve-out's other half: one tractor lifting
  // every container of ITS OWN lot is the standard lotFullyPlated rotation,
  // not the cross-lot claim the guard's copy names — those rows warn once
  // (confirm proceeds) and can never pin the hard tier. Found as a trunk-red
  // on the dispatch-detail-plan suite after card 101026043000 landed: the OWN
  // happy path (same truck on all three containers) went 409 with no path on.
  const crossLotConflicts = planConflicts.filter((conflict) => conflict.shipmentId !== args.shipmentId);
  const crossLotLclConflicts = lclPlanConflicts.filter((conflict) => conflict.shipmentId !== args.shipmentId);
  const sameLotPlanClaim = planConflicts.length > 0 || lclPlanConflicts.length > 0;
const planRowBlocked = isKepPairing ? false : (crossLotConflicts.length > 0 || crossLotLclConflicts.length > 0);
// Evidence strength (card 101026043000, FB-038 ruling "WARNING, not a hard
// block"): a PROVABLE overlap keeps its pinned tier — an active trip or plan
// claim refuses outright. An overlap the guard can only see through the
// DISPLAYED slot (either side's window rode the lot fallback) or around a
// degenerate staged end must WARN once and let the confirmed save proceed —
// never a silent save, never a guessed hard block (card 363's own "cannot
// prove overlap" law). The warn rides the family's warn-once contract
// (RIG_OVERLAP_COMPLETED + rigOverlapCompletedConfirmed) verbatim.
const weakEvidence = !args.window.strong
  || degenerateEnd
  || crossLotConflicts.some((conflict) => conflict.fallbackSlot);
if (planRowBlocked || tripConflicts.length > 0) {
    if (!weakEvidence) {
      throw new ApiError(409, `Đầu xe ${plate} đã được gán cho lô/tác vụ khác trong khung giờ trùng lặp.`);
    }
    if (!args.confirmOverlap) {
      throw new ApiError(409,
        `Đầu xe ${plate} đã được gán cho lô/tác vụ khác trong khung giờ trùng lặp. Vẫn lưu?`,
        undefined,
        { code: 'RIG_OVERLAP_COMPLETED' });
    }
  } else if (!isKepPairing && sameLotPlanClaim && !args.confirmOverlap) {
    // The lot's own rotation: warn once, never silently, never a hard block.
    throw new ApiError(409,
      `Đầu xe ${plate} đã được gán cho container khác của lô này trong khung giờ trùng lặp. Vẫn lưu?`,
      undefined,
      { code: 'RIG_OVERLAP_COMPLETED' });
  }
  // Card 061026172804 (FB-038 / REQ-04): a COMPLETED trip of the same rig no
  // longer blocks (card 363 released the rig on completion) but the overlap is
  // not silent either — the save is refused once with a warning payload the
  // editor turns into a confirm dialog; the confirmed retry proceeds (chạy
  // gối đầu onto a finished trip is legal). Same overlap rule and 8-hour
  // default as the active-trip scan above.
  if (!args.confirmOverlap) {
    const completedTripConflicts = await tx.select({ id: s.trips.id, code: s.trips.tripCode })
      .from(s.trips)
      .innerJoin(s.trucks, eq(s.trucks.id, s.trips.truckId))
      .where(and(
        eq(s.trucks.licensePlate, plate),
        eq(s.trips.status, TripStatus.COMPLETED),
        isNull(s.trips.deletedAt),
        isNotNull(s.trips.plannedStartAt),
        lt(s.trips.plannedStartAt, windowEnd),
        sql`coalesce(${s.trips.plannedEndAt}, ${s.trips.plannedStartAt} + interval '8 hours') > ${windowStart.toISOString()}::timestamptz`,
      ));
    if (completedTripConflicts.length > 0) {
      throw new ApiError(409,
        `Đầu xe ${plate} có ${completedTripConflicts.length} chuyến đã hoàn thành trùng khung giờ phân công này. Vẫn lưu?`,
        undefined,
        { code: 'RIG_OVERLAP_COMPLETED' });
    }
  }
}

export async function updateDispatchDetailPlan(input: UpdateDispatchDetailPlanInput): Promise<DispatchDetailPlanMutationResult & { replayed: boolean }> {
  assertDispatchActor(input.actor);
  const outcome = await runIdempotent<DispatchDetailPlanMutationResult>({
    endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_FULFILLMENT_PLAN_UPDATE,
    idempotencyKey: input.idempotencyKey,
    payload: {
      fulfillmentId: input.fulfillmentId,
      expectedFulfillmentVersion: input.expectedFulfillmentVersion,
      expectedShipmentVersion: input.expectedShipmentVersion,
      carrierType: input.carrierType,
      externalCarrierId: input.externalCarrierId ?? null,
      truckId: input.truckId ?? null,
      externalCarrierVehicleId: input.externalCarrierVehicleId ?? null,
      plateNumber: input.plateNumber ?? null,
      clearVehicle: input.clearVehicle === true,
      plannedRevenue: input.plannedRevenue,
      plannedCarrierCost: input.plannedCarrierCost,
      classification: input.classification ?? null as unknown as DispatchClassification,
      isCombined: input.isCombined,
      // Note and Giờ trả hàng are part of the dedup payload: two saves
      // differing only in these must not collide as the same idempotent request.
      operationalNotes: input.operationalNotes ?? null,
      plannedEndAt: input.plannedEndAt ?? null,
    },
    createdBy: input.actor.userId,
    entityType: 'shipment_fulfillments',
    getEntityId: (result) => result.fulfillmentId,
    create: (tx) => updateDispatchDetailPlanInTx(tx, input),
  });

  return { ...outcome.result, replayed: outcome.replayed };
}


export async function updateDispatchDetailPlanInTx(tx: Tx, input: UpdateDispatchDetailPlanInput): Promise<DispatchDetailPlanMutationResult> {
  // Lock shipment first, then fulfillment — the dispatch-issuance lock order.
  const [candidate] = await tx.select({ shipmentId: s.shipmentFulfillments.shipmentId })
    .from(s.shipmentFulfillments)
    .where(and(eq(s.shipmentFulfillments.id, input.fulfillmentId), isNull(s.shipmentFulfillments.canceledAt)))
    .limit(1);
  if (!candidate) throw new ApiError(404, 'Không tìm thấy tác vụ điều xe.');

  const [shipment] = await tx.select().from(s.shipments)
    .where(and(eq(s.shipments.id, candidate.shipmentId), isNull(s.shipments.deletedAt)))
    .for('update')
    .limit(1);
  if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng.');

  // Union of the strongest guards from every legacy single-field endpoint.
  await assertActorCanAccessShipment(tx, shipment.id, input.actor, { write: true });
  await assertShipmentAccountingUnlocked(tx, shipment.id);
  // Per-container planning: only terminal lot statuses block plan saves. A
  // partially-dispatched lot keeps its remaining READY rows editable — the
  // lot status flips to DISPATCHED as soon as the first container's order is
  // issued, and the old READY_FOR_DISPATCH-only guard stranded the 2nd
  // container's planning entirely (2026-09-09 bug: the dispatcher could not
  // save the driver-note tags on the remaining container, and the UI mapped
  // the 409 to a misleading "reload" banner). Mirrors the 2026-09-05
  // issuance-side fix in dispatch-planning-commands.service.ts; the per-row
  // live-trip guard below is what keeps issued rows un-editable.
  const planSaveStatus = canonicalShipmentStatus(shipment.status);
  if (planSaveStatus === 'COMPLETED' || planSaveStatus === 'CANCELED') {
    throw new ApiError(409, 'Lô hàng đã kết thúc, không thể lưu kế hoạch.');
  }
  if (shipment.version !== input.expectedShipmentVersion) {
    throw new ApiError(409, 'Lô hàng đã thay đổi. Vui lòng tải lại.');
  }

  const [fulfillment] = await tx.select().from(s.shipmentFulfillments)
    .where(and(
      eq(s.shipmentFulfillments.id, input.fulfillmentId),
      isNull(s.shipmentFulfillments.canceledAt),
    ))
    .limit(1)
    .for('update');
  if (!fulfillment) throw new ApiError(404, 'Không tìm thấy tác vụ điều xe.');
  if (fulfillment.version !== input.expectedFulfillmentVersion) {
    throw new ApiError(409, 'Tác vụ điều xe đã thay đổi. Vui lòng tải lại.');
  }
  if (await loadLiveTripForFulfillment(tx, fulfillment.id)) {
    throw new ApiError(409, 'Không thể sửa kế hoạch sau khi đã phát hành lệnh điều xe.');
  }

  // Giờ trả hàng staging: undefined = untouched; null/'' = clear; otherwise a
  // zone-qualified instant — validated before any write so an invalid value
  // changes nothing (all-or-nothing like carrier resolution). The FE owns the
  // after-start cross-field rule (card _15, 2026-09-26).
  const plannedEndAtProvided = input.plannedEndAt !== undefined;
  const nextPlannedEndAt = plannedEndAtProvided
    ? (input.plannedEndAt == null || input.plannedEndAt === '' ? null : parseIsoWithZone(input.plannedEndAt, 'Giờ trả hàng'))
    : null;

  // Carrier resolution — validated before any write, so an invalid carrier
  // changes nothing (all-or-nothing).
  let carrierName = INTERNAL_FLEET_CARRIER_NAME;
  let plannedExternalCarrierId: number | null = null;
  if (input.carrierType === 'OWN') {
    if (input.externalCarrierId != null) throw new ApiError(400, 'Xe nội bộ không dùng mã nhà xe ngoài.');
  } else {
    if (input.externalCarrierId == null) throw new ApiError(400, 'Nhà xe ngoài là bắt buộc.');
    const [carrier] = await tx.select({ id: s.customers.id, name: CUSTOMER_OPERATIONAL_NAME })
      .from(s.customers)
      .where(and(
        eq(s.customers.id, input.externalCarrierId),
        eq(s.customers.isCarrier, true),
        eq(s.customers.status, 'ACTIVE'),
        isNull(s.customers.deletedAt),
      ))
      .limit(1);
    if (!carrier) throw new ApiError(409, 'Nhà xe không còn hiệu lực.');
    carrierName = carrier.name;
    plannedExternalCarrierId = carrier.id;
  }

  // Vehicle resolution validates ownership against the incoming carrier. In
  // the atomic save the vehicle block is optional for both carrier types: an
  // editor save that changes only estimates/classification sends no vehicle
  // fields and leaves the plate untouched (null → keep stored columns) —
  // EXCEPT on a carrier switch, where an unspecified vehicle means "none for
  // the new carrier" and the previous carrier's vehicle/plate columns are
  // cleared, mirroring the legacy carrier endpoint.
  const carrierSwitched = fulfillment.plannedCarrierType !== input.carrierType;
  const vehicleSelected = input.truckId != null
    || input.externalCarrierVehicleId != null
    || input.plateNumber != null
    || input.clearVehicle === true
    || carrierSwitched;
  let vehicle: DispatchVehicleResolution | null = null;
  if (vehicleSelected) {
    vehicle = await resolveDispatchVehicleAssignment(tx, {
      carrierType: input.carrierType,
      plannedExternalCarrierId,
      truckId: input.truckId ?? null,
      externalCarrierVehicleId: input.externalCarrierVehicleId ?? null,
      plateNumber: input.plateNumber ?? null,
      clear: input.clearVehicle === true || (carrierSwitched && input.truckId == null && input.externalCarrierVehicleId == null && input.plateNumber == null),
    });
  }

  // Fulfillment row: assignment snapshot + estimates + classification.
  // Without a vehicle block the stored vehicle columns keep their values.
  if (vehicleSelected && vehicle?.plannedVehiclePlateNumber != null && vehicle.plannedVehiclePlateNumber.trim() !== '') {
    // Card 20261003_317: the plan-row edit assigns rigs BEFORE dispatch — the
    // same physical tractor must not be planned onto two fulfillments whose
    // windows overlap. The plate is the pre-dispatch rig identity (no planned
    // truck id is persisted); dispatched trips join by license plate.
    //
    // Card 061026174603: the window is resolved PER CARGO MODE. An FCL row's
    // window is its container's closing appointment; an LCL lot has no
    // container BY DESIGN — it decomposes into one LCL_SHIPMENT fulfillment —
    // so its window is the lot-level closing/return date, the same coalesce the
    // dispatch list itself reads. Resolving the window per mode is what lets
    // the Hàng lẻ dispatch flow run at all; a row whose window cannot be
    // resolved is skipped (the existing "cannot prove overlap" law), never
    // refused with a container error.
    const window = await resolvePlanRowWindow(tx, fulfillment);
    if (window != null) {
      await assertPlanRowRigAvailable(tx, {
        fulfillmentId: input.fulfillmentId,
        shipmentId: fulfillment.shipmentId,
        plate: vehicle.plannedVehiclePlateNumber,
        window,
        windowEnd: nextPlannedEndAt,
        confirmOverlap: input.rigOverlapCompletedConfirmed === true,
        classification: input.classification ?? null,
      });
    }
  }
  // Card 20261006_392: an LCL lot is ONE whole-lot LCL_SHIPMENT fulfillment, so
  // its only legal classification is 'LCL'. The DB enforces that with
  // shipment_fulfillments_lcl_dispatch_classification_check, and a save that
  // reached it answered the dispatcher with a raw PostgresError 23514 surfaced as
  // HTTP 500 'Lỗi máy chủ'. Refuse it as the business error it is, before the
  // write. 'LCL_PICKUP' ("Lấy Lẻ") stays legal on a CONTAINER row — it is the
  // 40'-trailer pickup run (see requiredTrailerTypeForFulfillment), and no
  // fulfillment row in the database has ever carried it.
  if (input.classification && fulfillment.fulfillmentType === 'LCL_SHIPMENT'
    && input.classification !== 'LCL') {
    throw new ApiError(409, 'Phân loại không hợp lệ cho lô Hàng lẻ. Lô hàng lẻ là một tác vụ cả lô nên chỉ dùng phân loại "Lẻ".');
  }
  const [updatedFulfillment] = await tx.update(s.shipmentFulfillments).set({
    plannedCarrierType: input.carrierType,
    plannedExternalCarrierId,
    ...(vehicle != null ? {
      plannedExternalCarrierVehicleId: vehicle.plannedExternalCarrierVehicleId,
      plannedVehiclePlateNumber: vehicle.plannedVehiclePlateNumber,
    } : {}),
    plannedRevenue: input.plannedRevenue == null ? null : String(input.plannedRevenue),
    plannedCarrierCost: input.plannedCarrierCost == null ? null : String(input.plannedCarrierCost),
    // Giờ trả hàng: a save that omits the field leaves the stored value untouched.
    ...(plannedEndAtProvided ? { plannedEndAt: nextPlannedEndAt } : {}),
    // Phân loại per-row is the dispatcher's call (2026-09-08): a save that
    // carries it rewrites the stored value; omitted = untouched.
    ...(input.classification ? { dispatchClassification: input.classification } : {}),
    version: fulfillment.version + 1,
    updatedAt: new Date(),
  }).where(and(
    eq(s.shipmentFulfillments.id, fulfillment.id),
    eq(s.shipmentFulfillments.version, fulfillment.version),
  )).returning();
  if (!updatedFulfillment) throw new ApiError(409, 'Tác vụ điều xe đã thay đổi. Vui lòng tải lại.');

  // Shipment row: isCombined is lot-level and independent of classification;
  // the driver-facing note (operationalNotes) rides the same shipment write.
  // Version bumps only when one of the two actually changes — a save that
  // keeps both at their stored values must not invalidate other tabs.
  // Undefined isCombined = "not part of this save" (the dispatch editor's
  // normal case now that the lot flag is CUS-owned); it must not be read as
  // a request to write `false` over a stored `true`.
  let shipmentVersion = shipment.version;
  // Accountant masking happens at the route gate (requireRoles excludes
  // ACCOUNTANT — same rule as the grid read at :386), so the type system
  // narrows actor to admin/manager/dispatcher here. Undefined note = "not
  // part of this save".
  const noteProvided = input.operationalNotes !== undefined;
  const nextNote = noteProvided ? (input.operationalNotes ?? '') : null;
  const notesChanged = noteProvided && nextNote !== (shipment.operationalNotes ?? '');
  const isCombinedChanged = input.isCombined !== undefined && shipment.isCombined !== input.isCombined;
  let storedNote = shipment.operationalNotes;
  let storedIsCombined = shipment.isCombined;
  if (isCombinedChanged || notesChanged) {
    const [updatedShipment] = await tx.update(s.shipments).set({
      ...(isCombinedChanged ? { isCombined: input.isCombined } : {}),
      ...(notesChanged ? { operationalNotes: nextNote } : {}),
      version: shipment.version + 1,
      updatedAt: new Date(),
    }).where(and(
      eq(s.shipments.id, shipment.id),
      eq(s.shipments.version, shipment.version),
    )).returning();
    if (!updatedShipment) throw new ApiError(409, 'Lô hàng đã thay đổi. Vui lòng tải lại.');
    shipmentVersion = updatedShipment.version;
    storedNote = updatedShipment.operationalNotes;
    storedIsCombined = updatedShipment.isCombined;
  }

  const lotFullyPlated = await recomputeLotFullyPlated(tx, shipment.id);

  const assignedDriverName = vehicle != null
    ? vehicle.assignedDriverName
    : input.carrierType === 'OWN' && updatedFulfillment.plannedVehiclePlateNumber
      ? (await loadPlannedDriverNames(tx, [updatedFulfillment.plannedVehiclePlateNumber]))
        .get(updatedFulfillment.plannedVehiclePlateNumber) ?? null
      : null;

  // Planning saves never notify the driver — dispatch-order issuance
  // (issueOrderCreateOrUpdate) owns the driver notification, so the driver
  // never sees or taps into a job that has no trips row yet.
  return {
    fulfillmentId: updatedFulfillment.id,
    fulfillmentVersion: updatedFulfillment.version,
    shipmentId: shipment.id,
    shipmentVersion,
    classification: updatedFulfillment.dispatchClassification,
    // Stored value, not the input: an omitted isCombined must echo back what
    // the lot actually holds so the grid keeps rendering its "Kết hợp" note.
    isCombined: storedIsCombined,
    // The route gate excludes ACCOUNTANT, so this is always the real note —
    // mirroring the grid read's non-accountant shape.
    operationalNotes: storedNote ?? null,
    dispatch: {
      carrierType: input.carrierType,
      carrierName,
      externalCarrierId: plannedExternalCarrierId,
      externalCarrierVehicleId: vehicle?.plannedExternalCarrierVehicleId ?? updatedFulfillment.plannedExternalCarrierVehicleId,
      assignedPlate: updatedFulfillment.plannedVehiclePlateNumber,
      assignedDriverName,
      // Plan saves only reach rows without a live trip (the per-row live-trip
      // guard keeps issued rows un-editable), so no acceptance can exist.
      driverAccepted: false,
    },
    estimates: {
      plannedRevenue: updatedFulfillment.plannedRevenue,
      plannedCarrierCost: updatedFulfillment.plannedCarrierCost,
    },
    // Stored value, not the input: an omitted save echoes what the row holds.
    plannedEndAt: toIsoOrNull(updatedFulfillment.plannedEndAt),
    lotFullyPlated,
    driverNotified: false,
    driverHint: vehicle?.driverHint ?? null,
  };
}


export async function recomputeLotFullyPlated(tx: Tx, shipmentId: number): Promise<boolean> {
  const [counts] = await tx.select({
    total: sql<number>`count(*)`,
    plated: sql<number>`count(*) filter (where ${s.shipmentFulfillments.plannedVehiclePlateNumber} is not null and ${s.shipmentFulfillments.plannedVehiclePlateNumber} <> '')`,
  }).from(s.shipmentFulfillments)
    .where(and(
      eq(s.shipmentFulfillments.shipmentId, shipmentId),
      isNull(s.shipmentFulfillments.canceledAt),
    ));
  const total = Number(counts?.total ?? 0);
  const plated = Number(counts?.plated ?? 0);
  return total > 0 && plated === total;
}
