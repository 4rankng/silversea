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
  shipmentStatusCondition,
  type ListShipmentsOptions,
} from './shipment-queries.service';
import { resolveShipmentPricingProjection } from './pricing.service';
import { listShipmentPodReviewItems, type ShipmentPodReviewItemView } from './trip-pod.service';
import { getShipmentAccountingLock } from './shipment-accounting-lock.service';
import { listShipmentContainers } from './shipment-containers.service';
import { listShipmentDocuments, listShipmentDeclarations } from './shipment-documents.service';
import { listPendingShipmentChangeRequests } from './shipment-shared.service';
import { sql } from 'drizzle-orm';

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
    conditions.push(shipmentStatusCondition(options.status));
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
    // Factory display label resolved through the operational_sites catalog
    // when shipment.factoryName / shipment.operationalSiteId are empty.
    // Mirrors cus-workspace `effectiveFactoryNames` priority so the detail
    // header (ShipmentDetailPage) agrees with the dashboard list view.
    effectiveFactoryName: string | null;
  };
  containers: Array<Awaited<ReturnType<typeof listShipmentContainers>>[number] & {
    /** Plate issued onto this container's fulfillment at dispatch. */
    plannedVehiclePlate: string | null;
  }>;
  documents: Awaited<ReturnType<typeof listShipmentDocuments>>;
  declarations: Awaited<ReturnType<typeof listShipmentDeclarations>>;
  statusHistory: Awaited<ReturnType<typeof listShipmentStatusHistory>>;
  pendingChangeRequests: Awaited<ReturnType<typeof listPendingShipmentChangeRequests>>;
  podReviews: ShipmentPodReviewItemView[];
  carrierAssignments: Awaited<ReturnType<typeof listShipmentCarrierAssignments>>;
  accountingLock: Awaited<ReturnType<typeof getShipmentAccountingLock>>;
}

/**
 * Attach the plate issued at dispatch onto each container row. The plate lives
 * on the fulfillment (planned_vehicle_plate_number mirrors the truck/external
 * vehicle at issuance); FCL fulfillments map 1:1 to containers via
 * shipment_container_id. Canceled fulfillments never contribute a plate.
 */
async function decorateContainersWithIssuedVehicle(
  shipmentId: number,
  containers: Awaited<ReturnType<typeof listShipmentContainers>>,
): Promise<ShipmentDetail['containers']> {
  if (containers.length === 0) return [];
  const fulfillments = await db.select({
    shipmentContainerId: s.shipmentFulfillments.shipmentContainerId,
    plannedVehiclePlateNumber: s.shipmentFulfillments.plannedVehiclePlateNumber,
  }).from(s.shipmentFulfillments)
    .where(and(
      eq(s.shipmentFulfillments.shipmentId, shipmentId),
      isNull(s.shipmentFulfillments.canceledAt),
    ));
  const plateByContainerId = new Map<number, string>();
  for (const row of fulfillments) {
    if (row.shipmentContainerId == null || !row.plannedVehiclePlateNumber) continue;
    if (!plateByContainerId.has(row.shipmentContainerId)) {
      plateByContainerId.set(row.shipmentContainerId, row.plannedVehiclePlateNumber);
    }
  }
  return containers.map((container) => ({
    ...container,
    plannedVehiclePlate: plateByContainerId.get(container.id) ?? null,
  }));
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

export async function getShipmentDetail(id: number, _actor?: AuthUser): Promise<ShipmentDetail> {
  // Fetch the shipment first so a missing row 404s cleanly rather than
  // returning an empty payload.
  const shipment = await getShipment(id);
  // Join the customer name so the detail page can show a readable label.
  // leftJoin keeps the row even if the
  // customer was hard-deleted (customerName = null in that case).
  const [joined] = await db.select({
    customerName: CUSTOMER_OPERATIONAL_NAME,
    cargoTypeName: s.cargoTypes.name,
  })
    .from(s.shipments)
    .leftJoin(s.customers, eq(s.customers.id, s.shipments.customerId))
    .leftJoin(s.cargoTypes, eq(s.cargoTypes.id, s.shipments.cargoTypeId))
    .where(eq(s.shipments.id, id));
  const shipmentWithCustomer = {
    ...shipment,
    // Hybrid display (MasterDataNhaMay §2.1 rule 4): the raw free-text name
    // stands in whenever no catalog customer is linked (Lệnh chạy ngoài).
    // isAdHoc / rawCustomerName / rawRouteName ride the row spread above.
    customerName: joined?.customerName ?? shipment.rawCustomerName ?? null,
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
  const decoratedContainers = await decorateContainersWithIssuedVehicle(id, containers);
  return {
    shipment: {
      ...shipmentWithCustomer,
      pricingProjection: await buildShipmentPricingProjection(shipment, containers),
      effectiveFactoryName: await resolveEffectiveFactoryName(shipment, decoratedContainers),
    },
    containers: decoratedContainers,
    documents,
    declarations,
    statusHistory,
    pendingChangeRequests,
    podReviews,
    carrierAssignments,
    accountingLock,
  };
}

/**
 * Resolve the factory display label for the detail-page header.
 *
 * Priority (mirrors cus-workspace `effectiveFactoryNames`):
 *   1. `shipments.factoryName` legacy free-text (set directly by CUS intake).
 *   2. `shipments.operational_site_id` → catalog short name.
 *   3. First non-null `shipment_containers.operational_site_id` → catalog
 *      short name. Catches the common case where a per-container factory was
 *      assigned (e.g. ASKEY-2 on a specific container) but the shipment-level
 *      factory fields are still empty — reported 2026-09-07 by Long Minh's
 *      CUS user when the detail header showed "—" despite `XƯỞNG 2` set.
 */
async function resolveEffectiveFactoryName(
  shipment: Awaited<ReturnType<typeof getShipment>>,
  containers: ShipmentDetail['containers'],
): Promise<string | null> {
  const legacy = typeof shipment.factoryName === 'string' ? shipment.factoryName.trim() : '';
  if (legacy) return legacy;
  const siteIds = new Set<number>();
  if (shipment.operationalSiteId != null) siteIds.add(shipment.operationalSiteId);
  for (const container of containers) {
    if (container.operationalSiteId != null) siteIds.add(container.operationalSiteId);
  }
  if (siteIds.size === 0) return null;
  const siteRows = await db.select({
    id: s.operationalSites.id,
    shortName: sql<string>`coalesce(nullif(btrim(${s.operationalSites.shortName}), ''), ${s.operationalSites.name})`,
  }).from(s.operationalSites)
    .where(inArray(s.operationalSites.id, [...siteIds]));
  const byId = new Map<number, string>();
  for (const row of siteRows) byId.set(row.id, row.shortName);
  if (shipment.operationalSiteId != null) {
    const resolved = byId.get(shipment.operationalSiteId);
    if (resolved) return resolved;
  }
  for (const container of containers) {
    if (container.operationalSiteId == null) continue;
    const resolved = byId.get(container.operationalSiteId);
    if (resolved) return resolved;
  }
  return null;
}
