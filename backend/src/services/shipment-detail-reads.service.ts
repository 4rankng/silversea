// Shipment detail reads — read model extracted from shipment.service.ts
// (maintainability round 3): single-row get, list, status history, carrier
// assignments, and the detail assembler that fans out to the sibling leaves.
// All user-facing messages in Vietnamese (PRD Mxx-HT-01).

import { db } from '../db';
import * as s from '../db/schema';
import { CARGO_MODE } from '../db/schema';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { ApiError } from '../errors';
import { localDateInBusinessZone } from '@tingting/shared';
import type { DispatchSummary } from '@tingting/shared';
import { operationalName } from '../db/master-data-name';
import type { AuthUser } from '../middleware/auth';
import type { Tx } from './trip-shared';
import {
  buildShipmentSearchPredicate,
  normalizeShipmentRow,
  normalizeShipmentStatusValue,
  type ListShipmentsOptions,
} from './shipment-queries.service';
import { resolveShipmentPricingProjection } from './pricing.service';
import {
  assertClerkCanAccessShipment,
  isClerkScopedUser,
  loadClerkShipmentScope,
} from './clerk-shipment-scope.service';
import { listShipmentPodReviewItems, type ShipmentPodReviewItemView } from './trip-pod.service';
import { getShipmentAccountingLock } from './shipment-accounting-lock.service';
import { listShipmentContainers } from './shipment-containers.service';
import { listShipmentDocuments, listShipmentDeclarations } from './shipment-documents.service';
import { listPendingShipmentChangeRequests } from './shipment-shared.service';

const CUSTOMER_OPERATIONAL_NAME = operationalName(s.customers.shortName, s.customers.name);

function normalizeShipmentStatusHistoryRow<
  T extends { fromStatus: string | null; toStatus: string },
>(row: T): T {
  const fromStatus = normalizeShipmentStatusValue(row.fromStatus);
  const toStatus = normalizeShipmentStatusValue(row.toStatus);
  return {
    ...row,
    fromStatus,
    toStatus: toStatus ?? row.toStatus,
  };
}

export type ListShipmentsPaginatedResult = {
  items: Array<ReturnType<typeof normalizeShipmentRow> & Record<string, unknown>>;
  total: number;
  page: number;
  limit: number;
  dispatchSummary?: DispatchSummary;
};

export async function getShipment(id: number, tx?: Tx) {
  const executor = tx ?? db;
  const [shipment] = await executor.select().from(s.shipments)
    .where(and(eq(s.shipments.id, id), isNull(s.shipments.deletedAt)))
    .limit(1);
  if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng');
  return normalizeShipmentRow(shipment);
}

export async function listShipments(options: ListShipmentsOptions = {}) {
  const conditions = [isNull(s.shipments.deletedAt)];
  if (options.customerIds?.length) {
    conditions.push(inArray(s.shipments.customerId, options.customerIds));
  } else if (options.customerId != null) {
    conditions.push(eq(s.shipments.customerId, options.customerId));
  }
  if (options.status != null) {
    conditions.push(options.status === 'PENDING_DATE'
      ? inArray(s.shipments.status, ['NEW', 'PENDING_DATE'])
      : options.status === 'NEW'
        ? inArray(s.shipments.status, ['NEW', 'PENDING_DATE', 'READY_FOR_DISPATCH'])
        : eq(s.shipments.status, options.status));
  }
  const searchPredicate = buildShipmentSearchPredicate(options.q);
  if (searchPredicate) {
    conditions.push(searchPredicate);
  }

  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
  const offset = Math.max(0, options.offset ?? 0);

  const rows = await db.select({ shipment: s.shipments }).from(s.shipments)
    .leftJoin(s.customers, eq(s.shipments.customerId, s.customers.id))
    .where(and(...conditions))
    .orderBy(desc(s.shipments.createdAt))
    .limit(limit)
    .offset(offset);
  return rows.map((row) => normalizeShipmentRow(row.shipment));
}

type ShipmentPricingProjectionView = Awaited<ReturnType<typeof resolveShipmentPricingProjection>>;

async function buildShipmentPricingProjection(
  shipment: Pick<
    typeof s.shipments.$inferSelect,
    'customerId'
    | 'routeId'
    | 'cargoTypeId'
    | 'cargoMode'
    | 'expectedDeliveryDate'
    | 'cargoWeightKg'
  >,
  containers: ReadonlyArray<Pick<typeof s.shipmentContainers.$inferSelect, 'containerTypeId' | 'routeId' | 'customerAppointmentAt'>>,
): Promise<ShipmentPricingProjectionView> {
  return resolveShipmentPricingProjection({
    customerId: shipment.customerId,
    routeId: shipment.routeId,
    cargoMode: shipment.cargoMode,
    cargoTypeId: shipment.cargoTypeId,
    date: shipment.expectedDeliveryDate,
    cargoWeightKg: shipment.cargoWeightKg,
    containerCount: containers.length,
    containerTypeIds: containers.map((container) => container.containerTypeId),
    containerPricingLines: shipment.cargoMode === CARGO_MODE.FCL
      ? containers.map((container) => ({
          routeId: container.routeId,
          containerTypeId: container.containerTypeId,
          date: container.customerAppointmentAt
            ? localDateInBusinessZone(container.customerAppointmentAt)
            : shipment.expectedDeliveryDate,
        }))
      : undefined,
  });
}

// ─── Detail assembler (read model) ──────────────────────────────────────────
//
// `getShipment` returns the bare row; the route detail endpoint wants the full
// picture — containers, documents, declarations, status history — assembled in
// a single response. Each child query is a single indexed lookup by shipmentId,
// so there is no N+1.

export interface ShipmentDetail {
  // Raw shipment row + the joined customer name (nullable: leftJoin, so a
  // hard-deleted customer yields customerName = null).
  shipment: Awaited<ReturnType<typeof getShipment>> & {
    customerName: string | null;
    cargoTypeName: string | null;
    pricingProjection: ShipmentPricingProjectionView;
  };
  containers: Awaited<ReturnType<typeof listShipmentContainers>>;
  documents: Awaited<ReturnType<typeof listShipmentDocuments>>;
  declarations: Awaited<ReturnType<typeof listShipmentDeclarations>>;
  statusHistory: Awaited<ReturnType<typeof listShipmentStatusHistory>>;
  pendingChangeRequests: Awaited<ReturnType<typeof listPendingShipmentChangeRequests>>;
  podReviews: ShipmentPodReviewItemView[];
  carrierAssignments: Awaited<ReturnType<typeof listShipmentCarrierAssignments>>;
  accountingLock: Awaited<ReturnType<typeof getShipmentAccountingLock>>;
}

export async function listShipmentCarrierAssignments(shipmentId: number, tx?: Tx) {
  const executor = tx ?? db;
  return executor.select({
    fulfillmentId: s.shipmentFulfillments.id,
    fulfillmentVersion: s.shipmentFulfillments.version,
    shipmentContainerId: s.shipmentFulfillments.shipmentContainerId,
    containerTypeCode: s.containerTypes.code,
    containerTypeName: s.containerTypes.name,
    carrierType: s.shipmentFulfillments.plannedCarrierType,
    externalCarrierId: s.shipmentFulfillments.plannedExternalCarrierId,
    externalCarrierName: CUSTOMER_OPERATIONAL_NAME,
  })
    .from(s.shipmentFulfillments)
    .leftJoin(s.shipmentContainers, eq(s.shipmentContainers.id, s.shipmentFulfillments.shipmentContainerId))
    .leftJoin(s.containerTypes, eq(s.containerTypes.id, s.shipmentContainers.containerTypeId))
    .leftJoin(s.customers, eq(s.customers.id, s.shipmentFulfillments.plannedExternalCarrierId))
    .where(and(
      eq(s.shipmentFulfillments.shipmentId, shipmentId),
      isNull(s.shipmentFulfillments.canceledAt),
    ))
    .orderBy(asc(s.shipmentFulfillments.id));
}

export async function listShipmentStatusHistory(shipmentId: number, tx?: Tx) {
  const client = tx ?? db;
  const rows = await client.select().from(s.shipmentStatusHistory)
    .where(eq(s.shipmentStatusHistory.shipmentId, shipmentId))
    .orderBy(desc(s.shipmentStatusHistory.changedAt));
  return rows.map((row) => normalizeShipmentStatusHistoryRow(row));
}

export async function getShipmentDetail(id: number, actor?: AuthUser): Promise<ShipmentDetail> {
  // Fetch the shipment first so a missing row 404s cleanly rather than
  // returning an empty payload.
  const shipment = await getShipment(id);
  if (actor && isClerkScopedUser(actor)) {
    const scope = await loadClerkShipmentScope(actor.userId);
    assertClerkCanAccessShipment(scope, shipment);
  }
  // Join the customer name so the detail page can show a readable label.
  // leftJoin keeps the row even if the
  // customer was hard-deleted (customerName = null in that case).
  const [joined] = await db.select({
    customerName: CUSTOMER_OPERATIONAL_NAME,
    cargoTypeName: s.cargoTypes.name,
  })
    .from(s.shipments)
    .leftJoin(s.customers, eq(s.shipments.customerId, s.customers.id))
    .leftJoin(s.cargoTypes, eq(s.shipments.cargoTypeId, s.cargoTypes.id))
    .where(eq(s.shipments.id, id));
  const shipmentWithCustomer = {
    ...shipment,
    customerName: joined?.customerName ?? null,
    cargoTypeName: joined?.cargoTypeName ?? null,
  };
  const [containers, documents, declarations, statusHistory, pendingChangeRequests, podReviews, carrierAssignments, accountingLock] = await Promise.all([
    listShipmentContainers(id),
    listShipmentDocuments(id),
    listShipmentDeclarations(id),
    listShipmentStatusHistory(id),
    listPendingShipmentChangeRequests(id),
    listShipmentPodReviewItems(id),
    listShipmentCarrierAssignments(id),
    getShipmentAccountingLock(id),
  ]);
  return {
    shipment: {
      ...shipmentWithCustomer,
      pricingProjection: await buildShipmentPricingProjection(shipment, containers),
    },
    containers,
    documents,
    declarations,
    statusHistory,
    pendingChangeRequests,
    podReviews,
    carrierAssignments,
    accountingLock,
  };
}
