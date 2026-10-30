// Shipment detail reads — read model extracted from shipment.service.ts
// (maintainability round 3): single-row get, list, status history, carrier
// assignments, and the detail assembler that fans out to the sibling leaves.
// All user-facing messages in Vietnamese (PRD Mxx-HT-01).

import { db, type Executor } from '../db';
import * as s from '../db/schema';
import { CARGO_MODE } from '../db/schema';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { ApiError } from '../errors';
import { effectiveLotContainerCount, localDateInBusinessZone } from '@tingting/shared';
import type { DispatchSummary, TripPairKind } from '@tingting/shared';
import { operationalName } from '../db/master-data-name';
import type { AuthUser } from '../middleware/auth';
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
import { getShipmentFreightRateView, type ShipmentFreightRateView } from './freight-rate-snapshot-lifecycle.service';
import { listShipmentContainers } from './shipment-containers.service';
import { listShipmentDocuments, listShipmentDeclarations } from './shipment-documents.service';
import { listPendingShipmentChangeRequests } from './shipment-shared.service';
import { sql } from 'drizzle-orm';

const CUSTOMER_OPERATIONAL_NAME = operationalName(s.customers.shortName, s.customers.name);

// FB-107: the LCL "Kho lấy hàng" point names the site stored in
// `shipments.pickup_warehouse_site_id`, resolved through the same short-name
// authority every other master-data label uses (the list summaries project the
// identical expression under `pickupWarehouseSiteName`). Its own alias because
// the row already joins operational_sites for the delivery point.
const detailPickupWarehouseSite = alias(s.operationalSites, 'shipment_detail_pickup_warehouse_site');
const PICKUP_WAREHOUSE_OPERATIONAL_NAME = operationalName(
  detailPickupWarehouseSite.shortName,
  detailPickupWarehouseSite.name,
);

/** One container row as `listShipmentContainers` returns it: the stored
 *  columns plus the joined container-type labels. Named once so every helper
 *  in this assembler shares one shape instead of restating the query's type. */
type ShipmentContainerRow = typeof s.shipmentContainers.$inferSelect & {
  containerTypeName: string | null;
  containerTypeCode: string | null;
};

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

export async function getShipment(id: number, executor: Executor = db) {
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
    containerCount: effectiveLotContainerCount(shipment.cargoMode, containers.length),
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
    // FB-107: LCL lift/drop points. The "Kho lấy hàng" site CUS picked at
    // intake (short-name authority, same shape as effectiveFactoryName) plus
    // its site type, so the detail page can name both of the lot's operating
    // points instead of the dormant pickup_location/delivery_location columns.
    pickupWarehouseSiteName: string | null;
    pickupWarehouseSiteType: (typeof s.operationalSites.$inferSelect)['siteType'] | null;
    // Route display label with the SAME authority the overview rows show
    // (list joins coalesce(container.routeId, shipment.routeId), then the
    // ad-hoc rawRouteName) — without it a container-less LCL lot displays its
    // route on the overview and nowhere on the detail page (FB-074).
    routeName: string | null;
  };
  containers: Array<ShipmentContainerRow & {
    /** Plate issued onto this container's fulfillment at dispatch. */
    plannedVehiclePlate: string | null;
    /** Kind of the ACTIVE trip pair (Kẹp/Kết hợp) on this container's live trip; null when unpaired. */
    pairKind: TripPairKind | null;
    /** FB-107: Cảng nâng / Cảng hạ display names (short-name authority, the
     *  ad-hoc raw text standing in for a missing catalog row) — the detail
     *  page's Nơi nhận / Nơi giao for an FCL lot. Null when the column is
     *  empty, so the caller can fall back to the stored free text. */
    pickupPortName: string | null;
    dropoffPortName: string | null;
  }>;
  documents: Awaited<ReturnType<typeof listShipmentDocuments>>;
  declarations: Awaited<ReturnType<typeof listShipmentDeclarations>>;
  statusHistory: Awaited<ReturnType<typeof listShipmentStatusHistory>>;
  pendingChangeRequests: Awaited<ReturnType<typeof listPendingShipmentChangeRequests>>;
  podReviews: ShipmentPodReviewItemView[];
  carrierAssignments: Awaited<ReturnType<typeof listShipmentCarrierAssignments>>;
  accountingLock: Awaited<ReturnType<typeof getShipmentAccountingLock>>;
  /** Auto freight pricing: latest frozen snapshot + formula trace + override. */
  freightRate: ShipmentFreightRateView;
}

/**
 * Attach the Cảng nâng / Cảng hạ display names for each container row
 * (FB-107). The detail page shows the lot's two operating points under
 * Nơi nhận / Nơi giao; for an FCL lot those ARE the container ports, and the
 * column only stores ids — one lookup for the whole lot (no N+1). Short-name
 * authority, exactly like the master plan's port groups; an ad-hoc lot types
 * the port instead of picking one, so the raw text stands in.
 */
async function decorateContainersWithPortNames<T extends ShipmentContainerRow>(
  containers: T[],
): Promise<Array<T & { pickupPortName: string | null; dropoffPortName: string | null }>> {
  const portIds = [...new Set(containers
    .flatMap((row) => [row.pickupPortId, row.dropoffPortId])
    .filter((id): id is number => id != null))];
  const namesById = portIds.length === 0 ? new Map<number, string>() : new Map(
    (await db.select({ id: s.ports.id, name: operationalName(s.ports.shortName, s.ports.name) })
      .from(s.ports)
      .where(inArray(s.ports.id, portIds)))
      .map((port) => [port.id, port.name]),
  );
  return containers.map((container) => ({
    ...container,
    // A catalog id that resolves wins; otherwise the ad-hoc typed name stands
    // (and an empty side stays null so the caller can fall back further).
    pickupPortName: (container.pickupPortId != null ? namesById.get(container.pickupPortId) ?? null : null)
      ?? (container.rawPickupPortName?.trim() || null),
    dropoffPortName: (container.dropoffPortId != null ? namesById.get(container.dropoffPortId) ?? null : null)
      ?? (container.rawDropoffPortName?.trim() || null),
  }));
}

/**
 * Attach the plate issued at dispatch onto each container row. The plate lives
 * on the fulfillment (planned_vehicle_plate_number mirrors the truck/external
 * vehicle at issuance); FCL fulfillments map 1:1 to containers via
 * shipment_container_id. Canceled fulfillments never contribute a plate.
 */
async function decorateContainersWithIssuedVehicle<T extends ShipmentContainerRow>(
  shipmentId: number,
  containers: T[],
): Promise<Array<T & { plannedVehiclePlate: string | null }>> {
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

/**
 * Attach the ACTIVE pair kind (Kẹp/Kết hợp) onto each container whose live trip
 * is linked to a trip_pairs row (LoHangKepKetHop §3.2): this is the data source
 * for the [KẸP]/[KẾT HỢP] tag next to the container number on CUS surfaces.
 * The tag derives from the pair linkage, so breaking the pair removes it;
 * canceled fulfillments never contribute (their trips leave the pair on cancel).
 */
async function decorateContainersWithPairKind<T extends ShipmentContainerRow & { plannedVehiclePlate: string | null }>(
  shipmentId: number,
  containers: T[],
): Promise<Array<T & { pairKind: TripPairKind | null }>> {
  if (containers.length === 0) return [];
  const rows = await db.select({
    shipmentContainerId: s.shipmentFulfillments.shipmentContainerId,
    pairKind: s.tripPairs.pairKind,
  }).from(s.shipmentFulfillments)
    .innerJoin(s.trips, eq(s.trips.fulfillmentId, s.shipmentFulfillments.id))
    .innerJoin(s.tripPairs, eq(s.tripPairs.id, s.trips.activeTripPairId))
    .where(and(
      eq(s.shipmentFulfillments.shipmentId, shipmentId),
      isNull(s.shipmentFulfillments.canceledAt),
    ));
  const pairKindByContainerId = new Map<number, string>();
  for (const row of rows) {
    if (row.shipmentContainerId == null) continue;
    pairKindByContainerId.set(row.shipmentContainerId, row.pairKind);
  }
  return containers.map((container) => ({
    ...container,
    pairKind: (pairKindByContainerId.get(container.id) as TripPairKind | undefined) ?? null,
  }));
}

export async function listShipmentCarrierAssignments(shipmentId: number, executor: Executor = db) {
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

export async function listShipmentStatusHistory(shipmentId: number, executor: Executor = db) {
  const rows = await executor.select().from(s.shipmentStatusHistory)
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
    // FB-107: LCL lift/drop points — see PICKUP_WAREHOUSE_OPERATIONAL_NAME.
    pickupWarehouseSiteName: PICKUP_WAREHOUSE_OPERATIONAL_NAME,
    pickupWarehouseSiteType: detailPickupWarehouseSite.siteType,
  })
    .from(s.shipments)
    .leftJoin(s.customers, and(eq(s.customers.id, s.shipments.customerId), isNull(s.customers.deletedAt)))
    .leftJoin(s.cargoTypes, eq(s.cargoTypes.id, s.shipments.cargoTypeId))
    .leftJoin(detailPickupWarehouseSite, eq(s.shipments.pickupWarehouseSiteId, detailPickupWarehouseSite.id))
    .where(eq(s.shipments.id, id));
  const shipmentWithCustomer = {
    ...shipment,
    // Hybrid display (MasterDataNhaMay §2.1 rule 4): the raw free-text name
    // stands in whenever no catalog customer is linked (Lệnh chạy ngoài).
    // isAdHoc / rawCustomerName / rawRouteName ride the row spread above.
    customerName: joined?.customerName ?? shipment.rawCustomerName ?? null,
    cargoTypeName: joined?.cargoTypeName ?? null,
    // A lot with no warehouse site picked (ad-hoc, or an LCL lot saved before
    // the picker existed) keeps both null — the page then falls back to the
    // stored free text and finally '—'.
    pickupWarehouseSiteName: joined?.pickupWarehouseSiteName ?? null,
    pickupWarehouseSiteType: joined?.pickupWarehouseSiteType ?? null,
  };
  const [containers, documents, declarations, statusHistory, pendingChangeRequests, podReviews, carrierAssignments, accountingLock, freightRate] = await Promise.all([
    listShipmentContainers(id),
    listShipmentDocuments(id),
    listShipmentDeclarations(id),
    listShipmentStatusHistory(id),
    listPendingShipmentChangeRequests(id),
    listShipmentPodReviewItems(id),
    listShipmentCarrierAssignments(id),
    getShipmentAccountingLock(id),
    getShipmentFreightRateView(id),
  ]);
  const decoratedContainers = await decorateContainersWithPortNames(
    await decorateContainersWithPairKind(
      id,
      await decorateContainersWithIssuedVehicle(id, containers),
    ),
  );
  return {
    shipment: {
      ...shipmentWithCustomer,
      pricingProjection: await buildShipmentPricingProjection(shipment, containers),
      effectiveFactoryName: await resolveEffectiveFactoryName(shipment, decoratedContainers),
      routeName: await resolveEffectiveRouteName(shipment, decoratedContainers),
    },
    containers: decoratedContainers,
    documents,
    declarations,
    statusHistory,
    pendingChangeRequests,
    podReviews,
    carrierAssignments,
    accountingLock,
    // Auto freight pricing read model (docx §2-D): the latest frozen snapshot
    // + formula trace + any debit-note override. Read-only for every role —
    // overrides go through the financial endpoint (ACCOUNTANT+).
    freightRate,
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

/**
 * Route display label for the detail-page header — the same fact the overview
 * rows show (cards 101026163040 / FB-074). Mirrors the list authority
 * `coalesce(container.routeId, shipment.routeId)` (shipment-queries
 * list-summaries) and falls back to the ad-hoc free text, so a container-less
 * LCL lot still displays the route its overview line carries.
 */
async function resolveEffectiveRouteName(
  shipment: Awaited<ReturnType<typeof getShipment>>,
  containers: ShipmentDetail['containers'],
): Promise<string | null> {
  const routeIds: number[] = [];
  // Container routes lead: the overview identity line maps the containers
  // first (`c.routeName ?? row.routeName`) and only shows the lot route when
  // the lot has no containers at all.
  for (const container of containers) {
    if (container.routeId != null && !routeIds.includes(container.routeId)) routeIds.push(container.routeId);
  }
  if (shipment.routeId != null && !routeIds.includes(shipment.routeId)) routeIds.push(shipment.routeId);
  if (routeIds.length > 0) {
    const rows = await db.select({
      id: s.routes.id,
      name: operationalName(s.routes.shortName, s.routes.name),
    }).from(s.routes)
      .where(inArray(s.routes.id, routeIds));
    const byId = new Map(rows.map((row) => [row.id, row.name]));
    for (const routeId of routeIds) {
      const label = byId.get(routeId);
      if (label) return label;
    }
  }
  const raw = typeof shipment.rawRouteName === 'string' ? shipment.rawRouteName.trim() : '';
  return raw || null;
}
