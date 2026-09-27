// Shipment list summaries, declarations, appointment groups, factory/route names (card 20260927_145).
// 20/40 bucketing, carrier-allocation aggregates, list summaries, and the
// shared search predicate. This module is a LEAF: it imports only db/schema
// and shared lib helpers, never shipment.service, so both the main mutation
// service and future read-side consumers can depend on it without cycles.

import { db } from '../../db';
import type { AuthUser } from '../../middleware/auth';
import { count, gte } from 'drizzle-orm';
import { canonicalShipmentStatus, Role } from '@tingting/shared';
import { loadDispatchExpenseNotes } from '../dispatch-expense-notes.service';
import type { ShipmentStatus } from '../shipment-types';
import { containerTransportDateSql } from '../cus-shipment-workspace-reads.service';
import * as s from '../../db/schema';
import { CARGO_MODE } from '../../db/schema';
import { and, asc, desc, eq, ilike, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { localDateInBusinessZone, round2dp, TripStatus } from '@tingting/shared';

import { escapeLikeTerm } from '../../lib/format';
import { operationalName } from '../../db/master-data-name';
import type { DispatchCarrierKey, DispatchSummary } from '@tingting/shared';
import { filterContainersByDateRange } from '../container-date-filter';

// Codebase convention: each query service defines its own operational-name
// expression (see driver/gps/dispatch-planning/trip-queries services).

import { inferContainerBucket, computeContainerAggregates, AllocationStatus, ALLOCATION_STATUSES, INTERNAL_FLEET_CARRIER_NAME, CUSTOMER_OPERATIONAL_NAME, SITE_OPERATIONAL_NAME, ROUTE_OPERATIONAL_NAME, activeFulfillment } from './shared';
import { buildShipmentSearchPredicate, buildDispatchPortFacetPredicate, buildDispatchCarrierFacetPredicate, loadShipmentDispatchAggregates, computeDispatchSummaryForSet } from './dispatch-aggregates';
import type { ShipmentContainerPortGroup } from './container-aggregates';
import { loadShipmentListContainerPortGroups } from './container-aggregates';


export type ShipmentListSummary = {
  cargoSummary: string | null;
  shippingLineSummary: string | null;
  carrierSummary: string | null;
  vehiclePlateSummary: string | null;
};

function normalizeSummaryValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function appendUniqueSummaryValue(target: string[], seen: Set<string>, value: string | null | undefined) {
  const normalized = normalizeSummaryValue(value);
  if (!normalized) return;
  if (seen.has(normalized)) return;
  seen.add(normalized);
  target.push(normalized);
}

function summarizeCargo(
  shipment: Pick<typeof s.shipments.$inferSelect, 'cargoMode' | 'packageCount' | 'packageType'>,
  containerRows: Array<{ containerNumber: string | null }>,
): string | null {
  if (shipment.cargoMode === CARGO_MODE.LCL) {
    if (shipment.packageCount != null) {
      return `${shipment.packageCount} ${normalizeSummaryValue(shipment.packageType) ?? 'kiện'}`;
    }
    return normalizeSummaryValue(shipment.packageType);
  }

  const containerCount = containerRows.length;
  if (containerCount === 0) return null;

  const numbers: string[] = [];
  const seenNumbers = new Set<string>();
  for (const row of containerRows) {
    appendUniqueSummaryValue(numbers, seenNumbers, row.containerNumber);
  }
  return numbers.length > 0
    ? `${containerCount} cont: ${numbers.join(', ')}`
    : `${containerCount} cont`;
}

function carrierNameFromPlannedAuthority(fulfillment: {
  plannedCarrierType: string | null;
  plannedExternalCarrierId: number | null;
}, carriersById: Map<number, string>): string | null {
  if (fulfillment.plannedCarrierType === 'OWN') return INTERNAL_FLEET_CARRIER_NAME;
  if (fulfillment.plannedCarrierType === 'EXTERNAL' && fulfillment.plannedExternalCarrierId != null) {
    return carriersById.get(fulfillment.plannedExternalCarrierId) ?? null;
  }
  return null;
}

function carrierNameFromTripAuthority(trip: {
  carrierType: string | null;
  externalCarrierName: string | null;
}): string | null {
  if (trip.carrierType === 'OWN') return INTERNAL_FLEET_CARRIER_NAME;
  if (trip.carrierType === 'EXTERNAL') return normalizeSummaryValue(trip.externalCarrierName);
  return null;
}

export async function loadShipmentListDeclarationNumbers(
  shipmentIds: number[],
): Promise<Map<number, string>> {
  if (shipmentIds.length === 0) return new Map();
  const rows = await db.select({
    shipmentId: s.shipmentDeclarations.shipmentId,
    declarationNumber: s.shipmentDeclarations.declarationNumber,
    id: s.shipmentDeclarations.id,
  }).from(s.shipmentDeclarations)
    .where(inArray(s.shipmentDeclarations.shipmentId, shipmentIds))
    .orderBy(asc(s.shipmentDeclarations.shipmentId), desc(s.shipmentDeclarations.id));
  const map = new Map<number, string>();
  for (const row of rows) {
    if (!row.declarationNumber) continue;
    if (!map.has(row.shipmentId)) map.set(row.shipmentId, row.declarationNumber);
  }
  return map;
}

export async function loadShipmentListSummaries(
  shipments: Array<typeof s.shipments.$inferSelect>,
): Promise<Map<number, ShipmentListSummary>> {
  const shipmentIds = [...new Set(shipments.map((shipment) => shipment.id))];
  if (shipmentIds.length === 0) return new Map();

  const [containerRows, fulfillmentRows, tripRows] = await Promise.all([
    db.select({
      id: s.shipmentContainers.id,
      shipmentId: s.shipmentContainers.shipmentId,
      containerNumber: s.shipmentContainers.containerNumber,
      shippingLineName: s.shipmentContainers.shippingLineName,
    }).from(s.shipmentContainers)
      .where(inArray(s.shipmentContainers.shipmentId, shipmentIds))
      .orderBy(asc(s.shipmentContainers.shipmentId), asc(s.shipmentContainers.id)),
    db.select({
      id: s.shipmentFulfillments.id,
      shipmentId: s.shipmentFulfillments.shipmentId,
      plannedCarrierType: s.shipmentFulfillments.plannedCarrierType,
      plannedExternalCarrierId: s.shipmentFulfillments.plannedExternalCarrierId,
    }).from(s.shipmentFulfillments)
      .where(and(
        inArray(s.shipmentFulfillments.shipmentId, shipmentIds),
        isNull(s.shipmentFulfillments.canceledAt),
      ))
      .orderBy(asc(s.shipmentFulfillments.shipmentId), asc(s.shipmentFulfillments.id)),
    db.select({
      id: s.tripsComposite.id,
      shipmentId: s.tripsComposite.shipmentId,
      fulfillmentId: s.tripsComposite.fulfillmentId,
      carrierType: s.tripsComposite.carrierType,
      truckPlate: s.trucks.licensePlate,
      externalCarrierName: CUSTOMER_OPERATIONAL_NAME,
      externalPlateNumber: s.tripsComposite.externalPlateNumber,
    }).from(s.tripsComposite)
      .leftJoin(s.trucks, and(
        eq(s.trucks.id, s.tripsComposite.truckId),
        isNull(s.trucks.deletedAt),
      ))
      .leftJoin(s.customers, and(
        eq(s.customers.id, s.tripsComposite.externalEntityId),
        eq(s.tripsComposite.externalEntityType, 'CUSTOMER'),
        isNull(s.customers.deletedAt),
      ))
      .where(and(
        inArray(s.tripsComposite.shipmentId, shipmentIds),
        isNull(s.tripsComposite.deletedAt),
        ne(s.tripsComposite.status, TripStatus.CANCELED),
      ))
      .orderBy(asc(s.tripsComposite.shipmentId), asc(s.tripsComposite.id)),
  ]);

  const plannedCarrierIds = [...new Set(
    fulfillmentRows
      .map((row) => row.plannedExternalCarrierId)
      .filter((value): value is number => value != null),
  )];
  const carriersById = plannedCarrierIds.length > 0
    ? new Map((await db.select({
      id: s.customers.id,
      name: CUSTOMER_OPERATIONAL_NAME,
    }).from(s.customers)
      .where(and(
        inArray(s.customers.id, plannedCarrierIds),
        isNull(s.customers.deletedAt),
      ))).map((row) => [row.id, row.name]))
    : new Map<number, string | null>();

  const containersByShipment = new Map<number, typeof containerRows>();
  for (const row of containerRows) {
    const bucket = containersByShipment.get(row.shipmentId);
    if (bucket) bucket.push(row);
    else containersByShipment.set(row.shipmentId, [row]);
  }

  const fulfillmentsByShipment = new Map<number, typeof fulfillmentRows>();
  for (const row of fulfillmentRows) {
    const bucket = fulfillmentsByShipment.get(row.shipmentId);
    if (bucket) bucket.push(row);
    else fulfillmentsByShipment.set(row.shipmentId, [row]);
  }

  const tripsByShipment = new Map<number, typeof tripRows>();
  const tripsByFulfillment = new Map<number, typeof tripRows>();
  for (const row of tripRows) {
    if (row.shipmentId == null) continue;
    const shipmentBucket = tripsByShipment.get(row.shipmentId);
    if (shipmentBucket) shipmentBucket.push(row);
    else tripsByShipment.set(row.shipmentId, [row]);

    if (row.fulfillmentId != null) {
      const fulfillmentBucket = tripsByFulfillment.get(row.fulfillmentId);
      if (fulfillmentBucket) fulfillmentBucket.push(row);
      else tripsByFulfillment.set(row.fulfillmentId, [row]);
    }
  }

  const summaries = new Map<number, ShipmentListSummary>();
  for (const shipment of shipments) {
    const shipmentContainerRows = containersByShipment.get(shipment.id) ?? [];
    const shippingLineValues: string[] = [];
    const seenShippingLines = new Set<string>();
    appendUniqueSummaryValue(shippingLineValues, seenShippingLines, shipment.shippingLineName);
    for (const row of shipmentContainerRows) {
      appendUniqueSummaryValue(shippingLineValues, seenShippingLines, row.shippingLineName);
    }

    const carrierValues: string[] = [];
    const seenCarriers = new Set<string>();
    const vehicleValues: string[] = [];
    const seenVehicles = new Set<string>();
    const consumedTripIds = new Set<number>();

    for (const fulfillment of fulfillmentsByShipment.get(shipment.id) ?? []) {
      const liveTrips = tripsByFulfillment.get(fulfillment.id) ?? [];
      if (liveTrips.length > 0) {
        for (const trip of liveTrips) {
          consumedTripIds.add(trip.id);
          appendUniqueSummaryValue(
            carrierValues,
            seenCarriers,
            carrierNameFromTripAuthority(trip),
          );
          appendUniqueSummaryValue(
            vehicleValues,
            seenVehicles,
            trip.carrierType === 'OWN' ? trip.truckPlate : trip.externalPlateNumber,
          );
        }
        continue;
      }
      appendUniqueSummaryValue(
        carrierValues,
        seenCarriers,
        carrierNameFromPlannedAuthority(fulfillment, carriersById as Map<number, string>),
      );
    }

    for (const trip of tripsByShipment.get(shipment.id) ?? []) {
      if (consumedTripIds.has(trip.id)) continue;
      // Fulfillment-linked trips are authoritative only through the active
      // fulfillment loop above. This excludes trips left live on a canceled
      // fulfillment while preserving truly unlinked legacy trips.
      if (trip.fulfillmentId != null) continue;
      appendUniqueSummaryValue(
        carrierValues,
        seenCarriers,
        carrierNameFromTripAuthority(trip),
      );
      appendUniqueSummaryValue(
        vehicleValues,
        seenVehicles,
        trip.carrierType === 'OWN' ? trip.truckPlate : trip.externalPlateNumber,
      );
    }

    summaries.set(shipment.id, {
      cargoSummary: summarizeCargo(shipment, shipmentContainerRows),
      shippingLineSummary: shippingLineValues.length > 0 ? shippingLineValues.join(', ') : null,
      carrierSummary: carrierValues.length > 0 ? carrierValues.join(', ') : null,
      vehiclePlateSummary: vehicleValues.length > 0 ? vehicleValues.join(', ') : null,
    });
  }

  return summaries;
}

// ─── Dispatch master-plan facets ──────────────────────────────────

/**
 * EXISTS-style facet predicates for the master-plan list. Matching happens on
 * active fulfillments only (canceled rows excluded) via correlated subqueries,
 * so a multi-container shipment never duplicates rows or inflates totals.
 * Semantics (plan phase-02):
 * - portIds: OR within ports — a shipment matches when ANY of its containers
 *   uses the port as pickup OR dropoff. Container-direct (not
 *   fulfillment-mediated) because the master grid lists shipments of all
 *   statuses and fulfillments only exist from READY_FOR_DISPATCH onward;
 *   ports are physical attributes of the container row.
 * - carrierKeys: OR within carriers; AND with ports/dates.
 *   OWN = at least one active fulfillment planned OWN; EXTERNAL:<id> = at
 *   least one planned to that carrier; UNASSIGNED = at least one active
 *   required fulfillment with no planned carrier (partially allocated
 *   shipments remain discoverable).
 */

/** Active (non-canceled) fulfillments only. */


export interface ShipmentAppointmentGroup {
  /** ISO 8601 timestamp of the appointment instant (per-container). */
  at: string;
  /** Local-date in the business zone (Asia/Ho_Chi_Minh) — YYYY-MM-DD. */
  localDate: string;
  /** Backward-compatible operational label: the factory short name. */
  factoryName: string | null;
  /** Effective factory short name for operational surfaces. */
  factoryShortName: string | null;
  /** Effective factory full name, retained for legal-document preparation. */
  factoryFullName: string | null;
  /** Compact per-type container summary, e.g. "1 x 40DC + 1 x 20DC". */
  containerSummary: string;
}

type ShipmentAppointmentGroupSource = {
  shipmentId: number;
  at: Date;
  factorySiteId: number | null;
  factoryShortName: string | null;
  factoryFullName: string | null;
  containerTypeCode: string | null;
  containerTypeName: string | null;
};

/** Groups fully-resolved appointment authority for one paginated list read. */
export function groupShipmentAppointmentGroups(
  rows: readonly ShipmentAppointmentGroupSource[],
): Map<number, ShipmentAppointmentGroup[]> {
  type Bucket = ShipmentAppointmentGroup & { typeCounts: Map<string, number> };
  const byShipment = new Map<number, Map<string, Bucket>>();

  for (const row of rows) {
    const at = row.at.toISOString();
    const factoryKey = row.factorySiteId != null
      ? `site:${row.factorySiteId}`
      : `legacy:${row.factoryFullName ?? row.factoryShortName ?? ''}`;
    const key = `${at}|${factoryKey}`;
    let buckets = byShipment.get(row.shipmentId);
    if (!buckets) {
      buckets = new Map();
      byShipment.set(row.shipmentId, buckets);
    }
    const typeLabel = row.containerTypeCode ?? row.containerTypeName ?? 'container';
    const existing = buckets.get(key);
    if (existing) {
      existing.typeCounts.set(typeLabel, (existing.typeCounts.get(typeLabel) ?? 0) + 1);
      continue;
    }
    buckets.set(key, {
      at,
      localDate: localDateInBusinessZone(row.at) ?? '0000-00-00',
      factoryName: row.factoryShortName,
      factoryShortName: row.factoryShortName,
      factoryFullName: row.factoryFullName,
      containerSummary: '',
      typeCounts: new Map([[typeLabel, 1]]),
    });
  }

  const result = new Map<number, ShipmentAppointmentGroup[]>();
  for (const [shipmentId, buckets] of byShipment) {
    result.set(shipmentId, [...buckets.values()]
      .map(({ typeCounts, ...group }) => ({
        ...group,
        containerSummary: [...typeCounts.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([code, count]) => `${count} x ${code}`)
          .join(' + ') || '—',
      }))
      .sort((a, b) => a.at.localeCompare(b.at)
        || (a.factoryName ?? '').localeCompare(b.factoryName ?? '')));
  }
  return result;
}

/**
 * Distinct effective factory labels per shipment for the master-plan
 * "Khách hàng & nhà máy" column. Unlike the appointment groups, this view is
 * NOT gated on `customerAppointmentAt`: a lot whose containers have not
 * locked a đóng/trả date still lists every factory. Precedence mirrors the
 * appointment-group resolution — container site → shipment site → legacy
 * factory text — so both views can never disagree on the label for a site.
 */
export async function loadShipmentListFactoryNames(
  shipments: Array<typeof s.shipments.$inferSelect>,
): Promise<Map<number, string[]>> {
  const ids = [...new Set(shipments.map((shipment) => shipment.id))];
  if (ids.length === 0) return new Map();

  const containerRows = await db.select({
    shipmentId: s.shipmentContainers.shipmentId,
    operationalSiteId: s.shipmentContainers.operationalSiteId,
  }).from(s.shipmentContainers)
    .where(inArray(s.shipmentContainers.shipmentId, ids));

  const siteIds = [...new Set([
    ...containerRows.map((row) => row.operationalSiteId),
    ...shipments.map((shipment) => shipment.operationalSiteId),
  ].filter((id): id is number => id != null))];
  const sitesById = siteIds.length === 0
    ? new Map<number, string>()
    : new Map((await db.select({
      id: s.operationalSites.id,
      shortName: SITE_OPERATIONAL_NAME,
    })
      .from(s.operationalSites)
      .where(inArray(s.operationalSites.id, siteIds)))
      .map((row) => [row.id, row.shortName]));

  const byShipment = new Map<number, Set<string>>();
  for (const shipment of shipments) {
    byShipment.set(shipment.id, new Set<string>());
  }
  for (const row of containerRows) {
    // Containers without a site fall back to the shipment site in the
    // appointment-group view; here they must not inject a duplicate label.
    if (row.operationalSiteId == null) continue;
    const label = sitesById.get(row.operationalSiteId);
    if (label) byShipment.get(row.shipmentId)?.add(label);
  }
  for (const shipment of shipments) {
    const labels = byShipment.get(shipment.id);
    if (!labels) continue;
    if (labels.size === 0 && shipment.operationalSiteId != null) {
      const label = sitesById.get(shipment.operationalSiteId);
      if (label) labels.add(label);
    }
    const legacy = shipment.factoryName?.trim();
    if (labels.size === 0 && legacy) labels.add(legacy);
  }
  return new Map(
    [...byShipment.entries()].map(([shipmentId, labels]) => [
      shipmentId,
      [...labels].sort((left, right) => left.localeCompare(right, 'vi')),
    ]),
  );
}

/**
 * FCL routes belong to individual containers. Shipment-list cards remain a
 * summary surface, so they display the distinct effective route labels rather
 * than pretending a single shipment-level route applies to every container.
 */
export async function loadShipmentListRouteNames(
  shipments: Array<typeof s.shipments.$inferSelect>,
): Promise<Map<number, string[]>> {
  const ids = [...new Set(shipments.map((shipment) => shipment.id))];
  if (ids.length === 0) return new Map();

  const rows = await db.select({
    shipmentId: s.shipmentContainers.shipmentId,
    routeName: ROUTE_OPERATIONAL_NAME,
  }).from(s.shipmentContainers)
    .innerJoin(s.shipments, eq(s.shipments.id, s.shipmentContainers.shipmentId))
    .leftJoin(s.routes, eq(s.routes.id, sql<number>`coalesce(${s.shipmentContainers.routeId}, ${s.shipments.routeId})`))
    .where(inArray(s.shipmentContainers.shipmentId, ids));
  const rootRouteIds = [...new Set(shipments.map((shipment) => shipment.routeId).filter((id): id is number => id != null))];
  const rootRouteNames = rootRouteIds.length === 0
    ? new Map<number, string>()
    : new Map((await db.select({ id: s.routes.id, name: ROUTE_OPERATIONAL_NAME })
      .from(s.routes).where(inArray(s.routes.id, rootRouteIds)))
      .map((route) => [route.id, route.name]));

  const byShipment = new Map<number, Set<string>>(ids.map((id) => [id, new Set<string>()]));
  for (const row of rows) {
    const label = row.routeName?.trim();
    if (label) byShipment.get(row.shipmentId)?.add(label);
  }
  for (const shipment of shipments) {
    const labels = byShipment.get(shipment.id);
    if (!labels || labels.size > 0) continue;
    // LCL and legacy FCL rows without containers retain their existing route.
    if (shipment.routeId == null) continue;
    const label = rootRouteNames.get(shipment.routeId);
    if (label) labels.add(label);
  }
  return new Map([...byShipment.entries()].map(([id, labels]) => [
    id,
    [...labels].sort((left, right) => left.localeCompare(right, 'vi')),
  ]));
}

export async function loadShipmentListAppointmentGroups(
  shipments: Array<typeof s.shipments.$inferSelect>,
): Promise<Map<number, ShipmentAppointmentGroup[]>> {
  const ids = [...new Set(shipments.map((shipment) => shipment.id))];
  if (ids.length === 0) return new Map();

  // Pull every container for the page with its appointment instant,
  // factory-site link, and resolved type code+name for the per-group summary.
  // shipment_containers has no deletedAt column (deletion is hard-delete at
  // the service layer, see reconcileShipmentContainersInTx) so no soft-delete
  // filter is needed here.
  const containerRows = await db.select({
    shipmentId: s.shipmentContainers.shipmentId,
    customerAppointmentAt: s.shipmentContainers.customerAppointmentAt,
    operationalSiteId: s.shipmentContainers.operationalSiteId,
    containerTypeCode: s.containerTypes.code,
    containerTypeName: s.containerTypes.name,
  }).from(s.shipmentContainers)
    .leftJoin(s.containerTypes, eq(s.containerTypes.id, s.shipmentContainers.containerTypeId))
    .where(inArray(s.shipmentContainers.shipmentId, ids))
    .orderBy(asc(s.shipmentContainers.shipmentId), asc(s.shipmentContainers.id));

  // Resolve every distinct site referenced at either authority level in one
  // query. The effective factory is container site → shipment site → factory
  // text, so shipment-level site ids must be available before grouping.
  const siteIds = [...new Set([
    ...containerRows.map((row) => row.operationalSiteId),
    ...shipments.map((shipment) => shipment.operationalSiteId),
  ].filter((id): id is number => id != null))];
  const sitesById = siteIds.length === 0
    ? new Map<number, { shortName: string; fullName: string }>()
    : new Map((await db.select({
      id: s.operationalSites.id,
      shortName: SITE_OPERATIONAL_NAME,
      fullName: s.operationalSites.name,
    })
      .from(s.operationalSites)
      .where(inArray(s.operationalSites.id, siteIds)))
      .map((row) => [row.id, { shortName: row.shortName, fullName: row.fullName }]));

  const shipmentsById = new Map(shipments.map((shipment) => [shipment.id, shipment]));

  // Resolve the full precedence chain before making the grouping key. Grouping
  // first and filling shipment-level fallbacks later splits containers which
  // share one effective factory into duplicate display lines.
  return groupShipmentAppointmentGroups(containerRows.flatMap((row) => {
    if (row.customerAppointmentAt == null) return [];
    const shipment = shipmentsById.get(row.shipmentId);
    const factorySiteId = row.operationalSiteId ?? shipment?.operationalSiteId ?? null;
    const factorySite = factorySiteId != null ? sitesById.get(factorySiteId) : null;
    const legacyFactoryName = shipment?.factoryName?.trim() ?? null;
    return [{
      shipmentId: row.shipmentId,
      at: row.customerAppointmentAt,
      factorySiteId,
      factoryShortName: factorySite?.shortName ?? legacyFactoryName,
      factoryFullName: factorySite?.fullName ?? legacyFactoryName,
      containerTypeCode: row.containerTypeCode,
      containerTypeName: row.containerTypeName,
    }];
  }));
}

export interface ListShipmentsOptions {
  customerId?: number;
  customerIds?: number[];
  /** Single status (legacy NEW/PENDING_DATE expansions apply) or an explicit
   *  status set — the dispatch master plan passes the full operational set so
   *  a lot stays visible after it dispatches or completes. */
  status?: ShipmentStatus | ShipmentStatus[];
  q?: string;
  /** W4 20260805_03 filter: limit to one trade direction. */
  tradeDirection?: 'IMPORT' | 'EXPORT';
  /** W4 20260805_03 filter: lower bound on customsCutoffAt (Ngày đóng/trả). */
  dateFrom?: string;
  /** W4 20240805_03 filter: upper bound on customsCutoffAt. */
  dateTo?: string;
  /** W4 20260805_03 filter: exact-ish match on blNumber. */
  blNumber?: string;
  /** Dispatch master-plan filter: lower bound on expectedDeliveryDate (Ngày giao hàng). */
  deliveryDateFrom?: string;
  /** Dispatch master-plan filter: upper bound on expectedDeliveryDate. */
  deliveryDateTo?: string;
  /** Dispatch master-plan filter: derived carrier-allocation coverage. */
  /** Card 20260925_5: filter-only buckets. NOT_ALLOCATED is the merged
   * "Chờ phân xe" bucket (zero + partial); PENDING_CARRIER = date locked
   * (expectedDeliveryDate set) but zero carriers; FULLY_ALLOCATED unchanged.
   * PARTIALLY_ALLOCATED stays accepted server-side as the legacy merged-bucket
   * alias for stale clients; the derived ROW status wire contract is unchanged. */
  allocationStatus?: AllocationStatus | 'PENDING_CARRIER';
  /** Dispatch master-plan filter: OR-within pickup/dropoff port ids
   *  matched against active fulfillments' containers. */
  portIds?: number[];
  /** Dispatch master-plan filter: OR-within carrier keys (OWN / EXTERNAL:<id> /
   *  UNASSIGNED), AND-ed with portIds and dates. */
  carrierKeys?: string[];
  /** When true, also return dispatchSummary computed over the complete filtered
   *  set in the same snapshot as rows+count. */
  includeDispatchSummary?: boolean;
  limit?: number;
  offset?: number;
  actor?: AuthUser;
}

/**
 * WHERE condition for the list status filter. A single status keeps the legacy
 * NEW/PENDING_DATE bucket expansions; an explicit status set (dispatch master
 * plan's operational range) is matched verbatim with no expansions.
 */
export function shipmentStatusCondition(status: ShipmentStatus | ShipmentStatus[]): SQL {
  if (Array.isArray(status)) {
    return inArray(s.shipments.status, status);
  }
  return status === 'PENDING_DATE'
    ? inArray(s.shipments.status, ['NEW', 'PENDING_DATE'])
    : status === 'NEW'
      ? inArray(s.shipments.status, ['NEW', 'PENDING_DATE', 'READY_FOR_DISPATCH'])
      : eq(s.shipments.status, status);
}

/** listShipmentsPaginated result extended with the full-filtered-set summary. */

export async function listShipmentsPaginated(options: ListShipmentsOptions & { page?: number }) {
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
  const page = Math.max(1, options.page ?? 1);
  const offset = (page - 1) * limit;

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
  if (options.tradeDirection) {
    conditions.push(eq(s.shipments.tradeDirection, options.tradeDirection));
  }
  if (options.blNumber) {
    // Exact match on trimmed value; empty strings are ignored by the route layer.
    conditions.push(eq(s.shipments.blNumber, options.blNumber.trim()));
  }
  if (options.dateFrom) {
    const from = new Date(options.dateFrom);
    if (!isNaN(from.getTime())) {
      conditions.push(gte(s.shipments.customsCutoffAt, from));
    }
  }
  if (options.dateTo) {
    const to = new Date(options.dateTo);
    if (!isNaN(to.getTime())) {
      // Inclusive end-of-day: bump to T23:59:59.999Z if user gave a date-only.
      const inclusive = options.dateTo.length === 10
        ? new Date(to.getTime() + 24 * 60 * 60 * 1000 - 1)
        : to;
      conditions.push(lte(s.shipments.customsCutoffAt, inclusive));
    }
  }
  // Dispatch master-plan: delivery-date range filters on the per-container
  // appointment date (with shipment-level EDD as fallback), so a shipment
  // whose CUS-set container appointment differs from the shipment's EDD still
  // shows up under the user's chosen day. Mirrors the CUS workspace
  // contract (containerTransportDateSql): coalesce(date(customerAppointmentAt
  // at time zone 'Asia/Ho_Chi_Minh'), shipments.expectedDeliveryDate).
  if (options.deliveryDateFrom || options.deliveryDateTo) {
    const from = options.deliveryDateFrom ?? '0001-01-01';
    const to = options.deliveryDateTo ?? '9999-12-31';
    // Either the shipment's EDD is in range, OR at least one container's
    // appointment date is in range. The EXISTS branch covers the field-reported
    // bug where filtering by date dropped FCL shipments whose containers had
    // been reappointed to a day other than the shipment's EDD — most visible
    // once CUS has already assigned a carrier (the Kế hoạch tổng quát view
    // would show "Không có lô hàng nào cần phân xe" for a day that did have
    // plated, ready-to-dispatch lots).
    conditions.push(or(
      and(
        gte(s.shipments.expectedDeliveryDate, from),
        lte(s.shipments.expectedDeliveryDate, to),
      ),
      sql`exists (
        select 1 from ${s.shipmentContainers}
        where ${s.shipmentContainers.shipmentId} = ${s.shipments.id}
          and ${containerTransportDateSql()} between ${from} and ${to}
      )`,
    )!);
  }
  // Dispatch master-plan facets: OR within each dimension, AND
  // across dimensions. Correlated EXISTS keeps multi-container shipments to one
  // row and totals exact.
  const portFacet = buildDispatchPortFacetPredicate(options.portIds ?? []);
  if (portFacet) conditions.push(portFacet);
  const carrierFacet = buildDispatchCarrierFacetPredicate(options.carrierKeys ?? []);
  if (carrierFacet) conditions.push(carrierFacet);

  // allocationStatus is derived from container/fulfillment aggregates and
  // cannot live in the WHERE clause. When filtering on it, resolve the full
  // matching id set first, filter by the derived status, and paginate that id
  // list — keeps `total` exact and the page consistent. The id list is already
  // paginated, so the main query below must not apply offset/limit again.
  let derivedTotal: number | null = null;
  let paginatedByIds = false;
  if (options.allocationStatus) {
    const idRows = await db.select({ id: s.shipments.id, expectedDeliveryDate: s.shipments.expectedDeliveryDate })
      .from(s.shipments)
      .leftJoin(s.customers, and(eq(s.shipments.customerId, s.customers.id), isNull(s.customers.deletedAt)))
      .where(and(...conditions))
      .orderBy(desc(s.shipments.createdAt));
    const aggregatesById = await loadShipmentDispatchAggregates(idRows.map((row) => row.id));
    // One lot, one bucket — mutually exclusive by allocation state (lead
    // ruling on card 20260925_5): NOT_ALLOCATED+date → Chờ phân nhà xe ONLY;
    // PARTIALLY → Chờ phân xe ONLY (it has carriers); full → Đã phân xong.
    const matching = idRows.filter((row) => {
      const status = aggregatesById.get(row.id)?.allocationStatus ?? 'NOT_ALLOCATED';
      // One lot, one bucket — mutually exclusive by allocation state (lead
      // ruling on card 20260925_5): NOT_ALLOCATED+date → Chờ phân nhà xe ONLY;
      // PARTIALLY → Chờ phân xe ONLY (it has carriers); NOT_ALLOCATED without
      // a date → Chờ phân xe (date not locked); full → Đã phân xong.
      switch (options.allocationStatus) {
        case 'PENDING_CARRIER':
          return status === 'NOT_ALLOCATED' && row.expectedDeliveryDate != null;
        case 'FULLY_ALLOCATED':
          return status === 'FULLY_ALLOCATED';
        case 'PARTIALLY_ALLOCATED': // legacy alias → same membership as below
        case 'NOT_ALLOCATED':
          return status === 'PARTIALLY_ALLOCATED'
            || (status === 'NOT_ALLOCATED' && row.expectedDeliveryDate == null);
        default:
          return false;
      }
    });
    derivedTotal = matching.length;
    const pageIds = matching.slice(offset, offset + limit).map((row) => row.id);
    conditions.push(inArray(s.shipments.id, pageIds.length > 0 ? pageIds : [-1]));
    paginatedByIds = true;
  }

  // Join customers so the list can show a human-readable customer name
  // instead of a bare `customerId` ("KH #2698" is meaningless to users).
  // leftJoin (not innerJoin): a shipment whose customer was hard-deleted
  // must still appear, with customerName = null.
  const rowsQuery = db.select({
    shipment: s.shipments,
    customerName: CUSTOMER_OPERATIONAL_NAME,
    // Operational site preferred via short-name authority; stored shipment
    // factoryName remains the fallback when no site is linked.
    operationalSiteName: SITE_OPERATIONAL_NAME,
    routeName: ROUTE_OPERATIONAL_NAME,
    // "Ghi chú nhà máy": the factory's operating notes (strict rules).
    factoryNotes: s.operationalSites.strictRules,
  }).from(s.shipments)
    .leftJoin(s.customers, and(eq(s.shipments.customerId, s.customers.id), isNull(s.customers.deletedAt)))
    .leftJoin(s.operationalSites, eq(s.shipments.operationalSiteId, s.operationalSites.id))
    .leftJoin(s.routes, eq(s.shipments.routeId, s.routes.id))
    .where(and(...conditions))
    .orderBy(desc(s.shipments.createdAt));

  // When the caller wants the filtered-set summary, run rows+count+summary in
  // one read-only REPEATABLE READ transaction so all three see the same
  // snapshot — header totals can never drift from the list mid-request.
  let dispatchSummary: DispatchSummary | undefined;
  let items: Array<{
    shipment: typeof s.shipments.$inferSelect;
    customerName: string | null;
    operationalSiteName: string | null;
    routeName: string | null;
    factoryNotes: string | null;
  }> = [];
  let total = 0;
  let containerPortGroupsByShipmentId = new Map<number, ShipmentContainerPortGroup[]>();
  if (options.includeDispatchSummary) {
    await db.transaction(async (tx) => {
      // All three reads share this transaction's snapshot: page rows, total
      // count, and the filtered-set ids feeding the cargo summary.
      const pageQuery = tx.select({
        shipment: s.shipments,
        customerName: CUSTOMER_OPERATIONAL_NAME,
        operationalSiteName: SITE_OPERATIONAL_NAME,
        routeName: ROUTE_OPERATIONAL_NAME,
        factoryNotes: s.operationalSites.strictRules,
      }).from(s.shipments)
        .leftJoin(s.customers, and(eq(s.shipments.customerId, s.customers.id), isNull(s.customers.deletedAt)))
        .leftJoin(s.operationalSites, eq(s.shipments.operationalSiteId, s.operationalSites.id))
        .leftJoin(s.routes, eq(s.shipments.routeId, s.routes.id))
        .where(and(...conditions))
        .orderBy(desc(s.shipments.createdAt));
      const [pageRows, totalRows, filteredIdRows] = await Promise.all([
        paginatedByIds ? pageQuery : pageQuery.limit(limit).offset(offset),
        tx.select({ value: count() }).from(s.shipments)
          .leftJoin(s.customers, and(eq(s.shipments.customerId, s.customers.id), isNull(s.customers.deletedAt)))
          .where(and(...conditions)),
        tx.select({ id: s.shipments.id }).from(s.shipments)
          .leftJoin(s.customers, and(eq(s.shipments.customerId, s.customers.id), isNull(s.customers.deletedAt)))
          .where(and(...conditions)),
      ]);
      items = pageRows;
      total = Number(totalRows[0]?.value ?? 0);
      containerPortGroupsByShipmentId = await loadShipmentListContainerPortGroups(
        items.map((row) => row.shipment),
        tx as unknown as Pick<typeof db, 'select'>,
      );
      dispatchSummary = await computeDispatchSummaryForSet(
        filteredIdRows.map((row) => row.id),
        tx as unknown as Pick<typeof db, 'select'>,
        (options.deliveryDateFrom || options.deliveryDateTo)
          ? { dateFrom: options.deliveryDateFrom, dateTo: options.deliveryDateTo }
          : undefined,
      );
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
  } else {
    const [pageRows, totalRows] = await Promise.all([
      paginatedByIds ? rowsQuery : rowsQuery.limit(limit).offset(offset),
      db.select({ value: count() }).from(s.shipments)
        .leftJoin(s.customers, and(eq(s.shipments.customerId, s.customers.id), isNull(s.customers.deletedAt)))
        .where(and(...conditions)),
    ]);
    items = pageRows;
    total = Number(totalRows[0]?.value ?? 0);
  }
  const summariesByShipmentId = await loadShipmentListSummaries(items.map((row) => row.shipment));
  // W4 20260805_03: also fetch the first declaration number per shipment so
  // the CUS grid can show "Số tờ khai" without a second roundtrip.
  const declarationByShipmentId = await loadShipmentListDeclarationNumbers(
    items.map((row) => row.shipment.id),
  );
  // Flatten `shipment` + `customerName` into a single object so the route
  // layer returns `{ ...shipmentColumns, customerName }` directly.
  const dispatchAggregatesByShipmentId = await loadShipmentDispatchAggregates(
    items.map((row) => row.shipment.id),
  );
  // Per-instant container appointment groups so the dispatch master-plan
  // "Giờ:" line can render N rows (one per distinct appointment time) —
  // mirrors the CUS workspace contract from cus-shipment-workspace.service.
  const appointmentGroupsByShipmentId = await loadShipmentListAppointmentGroups(
    items.map((row) => row.shipment),
  );
  // Distinct effective factory labels per shipment: appointment groups already
  // resolve container-site → shipment-site → legacy-text precedence, so their
  // factory labels are the authoritative multi-factory view. Shipments whose
  // containers carry no appointment fall back to their single projected label.
  // (Task 2.1: the label set must come from ALL containers, not only those
  // with a locked đóng/trả appointment — delegated to the query service.)
  const factoryNamesByShipmentId = await loadShipmentListFactoryNames(
    items.map((row) => row.shipment),
  );
  const routeNamesByShipmentId = await loadShipmentListRouteNames(
    items.map((row) => row.shipment),
  );
  if (!options.includeDispatchSummary) {
    containerPortGroupsByShipmentId = await loadShipmentListContainerPortGroups(
      items.map((row) => row.shipment),
    );
  }
  const opsRecoveryNotes = options.actor && [Role.ADMIN, Role.DISPATCHER].includes(options.actor.role)
    ? await loadDispatchExpenseNotes(items.map(row => row.shipment.id)) : new Map<number, string[]>();
  const enrichRow = (row: (typeof items)[number]) => ({
    ...normalizeShipmentRow(row.shipment),
    customerName: row.customerName,
    // Operational-site short-name authority with stored factory text fallback
    // (master-plan "Xưởng/Điểm" projection, plan phase-02).
    factoryName: row.operationalSiteName ?? row.shipment.factoryName,
    // Factory operating notes for the master-plan notes column.
    factoryNotes: row.factoryNotes,
    opsRecoveryNotes: opsRecoveryNotes.get(row.shipment.id) ?? [],
    // Partial-missing-date warning (docx T2.2): how many containers of the
    // lot still lack a đóng/trả appointment. Zero when all are scheduled.
    containersMissingAppointment: dispatchAggregatesByShipmentId.get(row.shipment.id)?.containersMissingAppointment ?? 0,
    containerTotal: dispatchAggregatesByShipmentId.get(row.shipment.id)?.containerTotal ?? 0,
    // All effective factories of the lot (container-site authority first,
    // shipment-site fallback) so the master plan lists every factory instead
    // of one label. Derived from the appointment-group factory resolution,
    // plus the shipment-level factory for lots without appointments.
    factoryNames: factoryNamesByShipmentId.get(row.shipment.id) ?? [],
    // FCL is summarized here only; its individual container route remains
    // authoritative in detail/dispatch rows.
    routeName: routeNamesByShipmentId.get(row.shipment.id)?.join(' · ') || row.routeName,
    cargoSummary: summariesByShipmentId.get(row.shipment.id)?.cargoSummary ?? null,
    shippingLineSummary: summariesByShipmentId.get(row.shipment.id)?.shippingLineSummary ?? null,
    carrierSummary: summariesByShipmentId.get(row.shipment.id)?.carrierSummary ?? null,
    vehiclePlateSummary: summariesByShipmentId.get(row.shipment.id)?.vehiclePlateSummary ?? null,
    declarationNumber: declarationByShipmentId.get(row.shipment.id) ?? null,
    containerCount20: dispatchAggregatesByShipmentId.get(row.shipment.id)?.containerCount20 ?? 0,
    containerCount40: dispatchAggregatesByShipmentId.get(row.shipment.id)?.containerCount40 ?? 0,
    containerTypeSummary: dispatchAggregatesByShipmentId.get(row.shipment.id)?.containerTypeSummary ?? null,
    totalCargoWeightKg: dispatchAggregatesByShipmentId.get(row.shipment.id)?.totalCargoWeightKg ?? null,
    allocationStatus: dispatchAggregatesByShipmentId.get(row.shipment.id)?.allocationStatus ?? 'NOT_ALLOCATED',
    carrierAllocationSummary: dispatchAggregatesByShipmentId.get(row.shipment.id)?.carrierAllocationSummary ?? [],
    // Per-container appointment groups (P9 2.4 mapping). Empty array when
    // the lot has no per-container appointment set — callers can fall back
    // to shipment-level closingAt/plannedReturnAt in that case.
    appointmentGroups: appointmentGroupsByShipmentId.get(row.shipment.id) ?? [],
    // One row may include containers with different lift/drop ports. Do not
    // project the shipment's legacy pickupLocation/deliveryLocation as if
    // they applied to every container.
    containerPortGroups: containerPortGroupsByShipmentId.get(row.shipment.id) ?? [],
  });
  const flatItems = items.map(enrichRow);
  return dispatchSummary !== undefined
    ? { items: flatItems, total: derivedTotal ?? total, page, limit, dispatchSummary }
    : { items: flatItems, total: derivedTotal ?? total, page, limit };
}

// ─── Update (optimistic-lock) ───────────────────────────────────────────────

/**
 * Shipment-level factory validation (SILVER L1 P2): the site must exist,
 * belong to the given customer, be active, not soft-deleted, and be a
 * FACTORY. Shared by create, update, and change-request apply so no write
 * path can land cross-customer or wrong-type site authority.
 */

export function normalizeShipmentStatusValue(status: string | null | undefined): ShipmentStatus | null {
  return canonicalShipmentStatus(status);
}

export function normalizeShipmentRow<T extends { status: string | null }>(shipment: T): T {
  const normalizedStatus = normalizeShipmentStatusValue(shipment.status);
  return normalizedStatus == null
    ? shipment
    : { ...shipment, status: normalizedStatus } as T;
}
