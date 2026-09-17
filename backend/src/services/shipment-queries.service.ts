// Shipment Queries Service — read-model aggregates for the shipment list and
// dispatch master-plan views.
//
// Extracted from shipment.service.ts (T3b): pure read-path helpers — container
// 20/40 bucketing, carrier-allocation aggregates, list summaries, and the
// shared search predicate. This module is a LEAF: it imports only db/schema
// and shared lib helpers, never shipment.service, so both the main mutation
// service and future read-side consumers can depend on it without cycles.

import { db } from '../db';
import type { AuthUser } from '../middleware/auth';
import { count, gte } from 'drizzle-orm';
import { canonicalShipmentStatus, Role } from '@tingting/shared';
import { loadDispatchExpenseNotes } from './dispatch-expense-notes.service';
import type { ShipmentStatus } from './shipment-types';
import { containerTransportDateSql } from './cus-shipment-workspace-reads.service';
import * as s from '../db/schema';
import { CARGO_MODE } from '../db/schema';
import { and, asc, desc, eq, ilike, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { localDateInBusinessZone, round2dp, TripStatus } from '@tingting/shared';

import { escapeLikeTerm } from '../lib/format';
import { operationalName } from '../db/master-data-name';
import type { DispatchCarrierKey, DispatchSummary } from '@tingting/shared';
import { filterContainersByDateRange } from './container-date-filter';

// Codebase convention: each query service defines its own operational-name
// expression (see driver/gps/dispatch-planning/trip-queries services).
const CUSTOMER_OPERATIONAL_NAME = operationalName(s.customers.shortName, s.customers.name);
const SITE_OPERATIONAL_NAME = operationalName(s.operationalSites.shortName, s.operationalSites.name);
const ROUTE_OPERATIONAL_NAME = operationalName(s.routes.shortName, s.routes.name);

export type AllocationStatus = 'NOT_ALLOCATED' | 'PARTIALLY_ALLOCATED' | 'FULLY_ALLOCATED';
export const ALLOCATION_STATUSES: AllocationStatus[] = [
  'NOT_ALLOCATED',
  'PARTIALLY_ALLOCATED',
  'FULLY_ALLOCATED',
];

/**
 * Bucket a free-text container type into the 20'/40' size classes the carrier
 * allocation model works in. Uses the same anchored regex as
 * `containerSizeBucket` in shipment-intake.service.ts so aggregate counts can
 * never disagree with the enforcement path.
 */
function inferContainerBucket(label: string | null | undefined): 20 | 40 | null {
  const normalized = (label ?? '').toUpperCase().trim();
  if (/^20(?:\D|$)/.test(normalized)) return 20;
  if (/^40(?:\D|$)/.test(normalized)) return 40;
  return null;
}

interface ShipmentContainerAggregates {
  containerCount20: number;
  containerCount40: number;
  /** e.g. "2 x 40HC + 1 x 20DC" — grouped by raw container type code. */
  containerTypeSummary: string | null;
  totalCargoWeightKg: number | null;
  allocationStatus: AllocationStatus;
  /** Containers with no đóng/trả appointment yet (0 when every container
   *  has a date) — drives the partial-missing-date warning badge. */
  containersMissingAppointment: number;
  containerTotal: number;
}

function computeContainerAggregates(
  containers: Array<{ containerTypeCode: string | null; containerTypeName: string | null; cargoWeightKg: string | null; customerAppointmentAt?: Date | null }>,
  allocatedCount20: number,
  allocatedCount40: number,
): ShipmentContainerAggregates {
  const countByType = new Map<string, number>();
  let containerCount20 = 0;
  let containerCount40 = 0;
  let totalWeight = 0;
  let hasWeight = false;
  for (const container of containers) {
    const bucket = inferContainerBucket(`${container.containerTypeCode ?? ''} ${container.containerTypeName ?? ''}`.trim());
    if (bucket === 20) containerCount20 += 1;
    if (bucket === 40) containerCount40 += 1;
    const typeLabel = container.containerTypeCode ?? container.containerTypeName;
    if (typeLabel) countByType.set(typeLabel, (countByType.get(typeLabel) ?? 0) + 1);
    const weight = Number(container.cargoWeightKg);
    if (!isNaN(weight) && weight > 0) {
      totalWeight += weight;
      hasWeight = true;
    }
  }
  const typeParts = [...countByType.entries()].map(([code, count]) => `${count} x ${code}`);
  const allocationStatus: AllocationStatus = containers.length === 0 || (containerCount20 + containerCount40) === 0
    ? 'NOT_ALLOCATED'
    : allocatedCount20 === 0 && allocatedCount40 === 0
      ? 'NOT_ALLOCATED'
      : allocatedCount20 >= containerCount20 && allocatedCount40 >= containerCount40
        ? 'FULLY_ALLOCATED'
        : 'PARTIALLY_ALLOCATED';
  return {
    containerCount20,
    containerCount40,
    containerTypeSummary: typeParts.length > 0 ? typeParts.join(' + ') : null,
    totalCargoWeightKg: hasWeight ? round2dp(totalWeight) : null,
    allocationStatus,
    containersMissingAppointment: containers.filter((container) => container.customerAppointmentAt == null).length,
    containerTotal: containers.length,
  };
}

export interface ShipmentCarrierAllocationSummaryEntry {
  carrierType: 'OWN' | 'EXTERNAL';
  externalCarrierId: number | null;
  carrierLabel: string;
  count20: number;
  count40: number;
}

/** A distinct per-container lift/drop pair in a shipment list row. */
export interface ShipmentContainerPortGroup {
  pickupPortName: string | null;
  dropoffPortName: string | null;
  /**
   * Business-zone local date for the cont appointment that produced this
   * port pair. Null when the cont has no customerAppointmentAt set yet
   * (customer feedback L2 — 24/08/2026, used to filter the cảng cells
   * by day). `null` participates in the "no filter" fallback.
   */
  localDate: string | null;
  /** Compact type count for only the containers using this exact port pair. */
  containerSummary: string;
}

type ShipmentContainerPortGroupSource = {
  shipmentId: number;
  pickupPortName: string | null;
  dropoffPortName: string | null;
  containerTypeCode: string | null;
  containerTypeName: string | null;
  localDate: string | null;
};

/**
 * Keep lift/drop authority at the container boundary. A master-plan shipment
 * row may contain several pairs, so grouping happens by the pair, never by
 * the legacy shipment-level free-text locations.
 */
export function groupShipmentContainerPortGroups(
  rows: readonly ShipmentContainerPortGroupSource[],
): Map<number, ShipmentContainerPortGroup[]> {
  type Bucket = ShipmentContainerPortGroup & { typeCounts: Map<string, number> };
  const bucketsByShipment = new Map<number, Map<string, Bucket>>();

  for (const row of rows) {
    // Customer feedback L2 (24/08/2026) — group by (lift, drop, localDate)
    // so the cảng cells can be day-filtered on the frontend.
    const key = `${row.pickupPortName ?? ''}\u0000${row.dropoffPortName ?? ''}\u0000${row.localDate ?? ''}`;
    let shipmentBuckets = bucketsByShipment.get(row.shipmentId);
    if (!shipmentBuckets) {
      shipmentBuckets = new Map();
      bucketsByShipment.set(row.shipmentId, shipmentBuckets);
    }
    let bucket = shipmentBuckets.get(key);
    if (!bucket) {
      bucket = {
        pickupPortName: row.pickupPortName,
        dropoffPortName: row.dropoffPortName,
        localDate: row.localDate,
        containerSummary: '',
        typeCounts: new Map(),
      };
      shipmentBuckets.set(key, bucket);
    }
    const typeLabel = row.containerTypeCode ?? row.containerTypeName ?? 'Container';
    bucket.typeCounts.set(typeLabel, (bucket.typeCounts.get(typeLabel) ?? 0) + 1);
  }

  const result = new Map<number, ShipmentContainerPortGroup[]>();
  for (const [shipmentId, buckets] of bucketsByShipment) {
    result.set(shipmentId, [...buckets.values()].map(({ typeCounts, ...group }) => ({
      ...group,
      containerSummary: [...typeCounts.entries()]
        .map(([type, count]) => `${count} x ${type}`)
        .join(' + '),
    })));
  }
  return result;
}

/** Batched port-name resolution for the shipment/master-plan read model. */
export async function loadShipmentListContainerPortGroups(
  shipments: Array<typeof s.shipments.$inferSelect>,
  query: Pick<typeof db, 'select'> = db,
): Promise<Map<number, ShipmentContainerPortGroup[]>> {
  const shipmentIds = [...new Set(shipments.map((shipment) => shipment.id))];
  if (shipmentIds.length === 0) return new Map();

  const containerRows = await query.select({
    shipmentId: s.shipmentContainers.shipmentId,
    pickupPortId: s.shipmentContainers.pickupPortId,
    dropoffPortId: s.shipmentContainers.dropoffPortId,
    containerTypeCode: s.containerTypes.code,
    containerTypeName: s.containerTypes.name,
    // Customer feedback L2 — per-day port grouping. The frontend uses
    // `localDate` to recompute the Cảng nâng / Cảng hạ cells when the
    // dispatcher filters by a single day.
    customerAppointmentAt: s.shipmentContainers.customerAppointmentAt,
  }).from(s.shipmentContainers)
    .leftJoin(s.containerTypes, eq(s.containerTypes.id, s.shipmentContainers.containerTypeId))
    .where(inArray(s.shipmentContainers.shipmentId, shipmentIds))
    .orderBy(asc(s.shipmentContainers.shipmentId), asc(s.shipmentContainers.id));
  const portIds = [...new Set(containerRows.flatMap((row) => [row.pickupPortId, row.dropoffPortId])
    .filter((id): id is number => id != null))];
  const portNamesById = portIds.length === 0
    ? new Map<number, string>()
    : new Map((await query.select({ id: s.ports.id, name: s.ports.name, shortName: s.ports.shortName })
      .from(s.ports)
      .where(inArray(s.ports.id, portIds)))
      .map((port) => [port.id, port.shortName?.trim() || port.name]));

  return groupShipmentContainerPortGroups(containerRows.map((row) => ({
    shipmentId: row.shipmentId,
    pickupPortName: row.pickupPortId == null ? null : portNamesById.get(row.pickupPortId) ?? null,
    dropoffPortName: row.dropoffPortId == null ? null : portNamesById.get(row.dropoffPortId) ?? null,
    containerTypeCode: row.containerTypeCode,
    containerTypeName: row.containerTypeName,
    localDate: row.customerAppointmentAt == null ? null : localDateInBusinessZone(row.customerAppointmentAt),
  })));
}

/**
 * Dispatch master-plan enrichment: container aggregates + allocation status per
 * shipment, plus per-carrier 20'/40' counts for chip rendering. Batched (3
 * queries for the whole page) — no N+1.
 */
export async function loadShipmentDispatchAggregates(
  shipmentIds: number[],
): Promise<Map<number, ShipmentContainerAggregates & {
  carrierAllocationSummary: ShipmentCarrierAllocationSummaryEntry[];
}>> {
  const ids = [...new Set(shipmentIds)];
  const empty = new Map();
  if (ids.length === 0) return empty;

  const [containerRows, fulfillmentRows] = await Promise.all([
    db.select({
      shipmentId: s.shipmentContainers.shipmentId,
      containerTypeCode: s.containerTypes.code,
      containerTypeName: s.containerTypes.name,
      cargoWeightKg: s.shipmentContainers.cargoWeightKg,
      customerAppointmentAt: s.shipmentContainers.customerAppointmentAt,
    }).from(s.shipmentContainers)
      .leftJoin(s.containerTypes, eq(s.containerTypes.id, s.shipmentContainers.containerTypeId))
      .where(inArray(s.shipmentContainers.shipmentId, ids))
      .orderBy(asc(s.shipmentContainers.shipmentId), asc(s.shipmentContainers.id)),
    db.select({
      shipmentId: s.shipmentFulfillments.shipmentId,
      plannedCarrierType: s.shipmentFulfillments.plannedCarrierType,
      plannedExternalCarrierId: s.shipmentFulfillments.plannedExternalCarrierId,
      containerTypeCode: s.containerTypes.code,
      containerTypeName: s.containerTypes.name,
    }).from(s.shipmentFulfillments)
      .leftJoin(s.shipmentContainers, eq(s.shipmentContainers.id, s.shipmentFulfillments.shipmentContainerId))
      .leftJoin(s.containerTypes, eq(s.containerTypes.id, s.shipmentContainers.containerTypeId))
      .where(and(
        inArray(s.shipmentFulfillments.shipmentId, ids),
        isNull(s.shipmentFulfillments.canceledAt),
      ))
      .orderBy(asc(s.shipmentFulfillments.shipmentId), asc(s.shipmentFulfillments.id)),
  ]);

  const carrierIds = [...new Set(
    fulfillmentRows
      .filter((row) => row.plannedCarrierType === 'EXTERNAL' && row.plannedExternalCarrierId != null)
      .map((row) => row.plannedExternalCarrierId as number),
  )];
  const carriersById = carrierIds.length > 0
    ? new Map((await db.select({ id: s.customers.id, name: CUSTOMER_OPERATIONAL_NAME })
      .from(s.customers)
      .where(inArray(s.customers.id, carrierIds))).map((row) => [row.id, row.name]))
    : new Map<number, string | null>();

  const containersByShipment = new Map<number, Array<typeof containerRows[number]>>();
  for (const row of containerRows) {
    const bucket = containersByShipment.get(row.shipmentId);
    if (bucket) bucket.push(row);
    else containersByShipment.set(row.shipmentId, [row]);
  }

  // Group once — the per-shipment loop below then reads its slice in O(1).
  const fulfillmentsByShipment = new Map<number, Array<typeof fulfillmentRows[number]>>();
  for (const row of fulfillmentRows) {
    const bucket = fulfillmentsByShipment.get(row.shipmentId);
    if (bucket) bucket.push(row);
    else fulfillmentsByShipment.set(row.shipmentId, [row]);
  }

  const result = new Map<number, ShipmentContainerAggregates & {
    carrierAllocationSummary: ShipmentCarrierAllocationSummaryEntry[];
  }>();
  for (const id of ids) {
    const containers = containersByShipment.get(id) ?? [];
    // Group live fulfillments per carrier and bucket each assigned container.
    const byCarrier = new Map<string, ShipmentCarrierAllocationSummaryEntry>();
    let allocatedCount20 = 0;
    let allocatedCount40 = 0;
    for (const fulfillment of fulfillmentsByShipment.get(id) ?? []) {
      if (!fulfillment.plannedCarrierType) continue;
      const bucket = inferContainerBucket(`${fulfillment.containerTypeCode ?? ''} ${fulfillment.containerTypeName ?? ''}`.trim());
      if (!bucket) continue;
      const carrierType = fulfillment.plannedCarrierType as 'OWN' | 'EXTERNAL';
      const key = carrierType === 'OWN' ? 'OWN' : `EXTERNAL:${fulfillment.plannedExternalCarrierId}`;
      const current = byCarrier.get(key) ?? {
        carrierType,
        externalCarrierId: fulfillment.plannedExternalCarrierId,
        carrierLabel: carrierType === 'OWN'
          ? INTERNAL_FLEET_CARRIER_NAME
          : carriersById.get(fulfillment.plannedExternalCarrierId ?? -1) ?? 'Nhà xe chưa xác định',
        count20: 0,
        count40: 0,
      };
      if (bucket === 20) { current.count20 += 1; allocatedCount20 += 1; }
      if (bucket === 40) { current.count40 += 1; allocatedCount40 += 1; }
      byCarrier.set(key, current);
    }
    const aggregates = computeContainerAggregates(containers, allocatedCount20, allocatedCount40);
    result.set(id, { ...aggregates, carrierAllocationSummary: [...byCarrier.values()] });
  }
  return result;
}

export function buildShipmentSearchPredicate(search: string | undefined) {
  const trimmed = search?.trim();
  if (!trimmed) return undefined;
  const pattern = `%${escapeLikeTerm(trimmed)}%`;
  return or(
    ilike(s.shipments.shipmentCode, pattern),
    ilike(s.shipments.blNumber, pattern),
    ilike(s.shipments.bookingRef, pattern),
    ilike(CUSTOMER_OPERATIONAL_NAME, pattern),
    ilike(s.customers.name, pattern),
    ilike(s.shipments.factoryName, pattern),
    ilike(s.shipments.shippingLineName, pattern),
  );
}

const INTERNAL_FLEET_CARRIER_NAME = 'SilverSea';

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

// ─── Dispatch master-plan facets (Lạch Huyện) ──────────────────────────────────

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
const activeFulfillment = () => isNull(s.shipmentFulfillments.canceledAt);

export function buildDispatchPortFacetPredicate(portIds: number[]): SQL | undefined {
  const ids = [...new Set(portIds)].filter((id) => Number.isInteger(id) && id > 0);
  if (ids.length === 0) return undefined;
  const idList = sql.join(ids.map((id) => sql`${id}`), sql`, `);
  return sql`exists (
    select 1 from ${s.shipmentContainers} c
    where c.shipment_id = ${s.shipments.id}
      and (c.pickup_port_id in (${idList}) or c.dropoff_port_id in (${idList}))
  )`;
}

/** One selected carrier key → predicate over active fulfillments. */
function carrierKeyPredicate(key: DispatchCarrierKey): SQL {
  if (key === 'OWN') {
    return sql`exists (
      select 1 from ${s.shipmentFulfillments} f
      where f.shipment_id = ${s.shipments.id}
        and f.canceled_at is null
        and f.planned_carrier_type = 'OWN'
    )`;
  }
  if (key === 'UNASSIGNED') {
    // Truthful "Chưa điều xe": either carrier planning has not started (no
    // active fulfillment exists — mirrors NOT_ALLOCATED in the derived
    // allocationStatus) or at least one active fulfillment lacks a planned
    // carrier. Partially allocated shipments remain discoverable.
    return sql`(
      not exists (
        select 1 from ${s.shipmentFulfillments} f
        where f.shipment_id = ${s.shipments.id}
          and f.canceled_at is null
      )
      or exists (
        select 1 from ${s.shipmentFulfillments} f
        where f.shipment_id = ${s.shipments.id}
          and f.canceled_at is null
          and f.planned_carrier_type is null
      )
    )`;
  }
  const carrierId = Number(key.slice('EXTERNAL:'.length));
  return sql`exists (
    select 1 from ${s.shipmentFulfillments} f
    where f.shipment_id = ${s.shipments.id}
      and f.canceled_at is null
      and f.planned_carrier_type = 'EXTERNAL'
      and f.planned_external_carrier_id = ${carrierId}
  )`;
}

export function buildDispatchCarrierFacetPredicate(carrierKeys: string[]): SQL | undefined {
  const seen = new Set<string>();
  const predicates: SQL[] = [];
  for (const raw of carrierKeys) {
    if (!/^(OWN|UNASSIGNED|EXTERNAL:[1-9]\d*)$/.test(raw) || seen.has(raw)) continue;
    seen.add(raw);
    predicates.push(carrierKeyPredicate(raw as DispatchCarrierKey));
  }
  if (predicates.length === 0) return undefined;
  return sql`(${sql.join(predicates, sql` or `)})`;
}

/**
 * Cargo totals over the COMPLETE filtered set — never the loaded page. Runs in
 * the same transaction/snapshot as rows+count so header totals cannot drift
 * from the list. Sizes come from canonical container-type codes (20-prefixed
 * or 40-prefixed), matching inferContainerBucket; unknown sizes stay in
 * totalFclContainers but not in the 20/40 split. LCL fulfillments are counted
 * separately and NEVER counted as containers.
 */
export async function computeDispatchSummaryForSet(
  shipmentIds: number[],
  tx: Pick<typeof db, 'select'> = db,
  dateRange?: { dateFrom?: string; dateTo?: string },
): Promise<DispatchSummary> {
  const ids = [...new Set(shipmentIds)];
  if (ids.length === 0) {
    return { totalFclContainers: 0, size20ft: 0, size40ft: 0, sizeOther: 0, lclFulfillments: 0 };
  }
  const [rawContainerRows, lclRows] = await Promise.all([
    tx.select({
      shipmentId: s.shipmentContainers.shipmentId,
      code: s.containerTypes.code,
      name: s.containerTypes.name,
      customerAppointmentAt: s.shipmentContainers.customerAppointmentAt,
      expectedDeliveryDate: s.shipments.expectedDeliveryDate,
    }).from(s.shipmentContainers)
      .innerJoin(s.shipments, eq(s.shipments.id, s.shipmentContainers.shipmentId))
      .leftJoin(s.containerTypes, eq(s.containerTypes.id, s.shipmentContainers.containerTypeId))
      .where(inArray(s.shipmentContainers.shipmentId, ids)),
    tx.select({ shipmentId: s.shipmentFulfillments.shipmentId })
      .from(s.shipmentFulfillments)
      .where(and(
        inArray(s.shipmentFulfillments.shipmentId, ids),
        eq(s.shipmentFulfillments.fulfillmentType, 'LCL_SHIPMENT'),
        activeFulfillment(),
      )),
  ]);

  // Scope container counts to the active date range when one is present.
  // Undated containers inherit the shipment's expected delivery date — the
  // same column the deliveryDateFrom/To row filter uses — so the summary
  // cannot zero-count rows the filter still returns.
  const containerRows = dateRange
    ? filterContainersByDateRange(rawContainerRows, dateRange.dateFrom, dateRange.dateTo, (row) => row.expectedDeliveryDate)
    : rawContainerRows;

  let size20 = 0;
  let size40 = 0;
  let sizeOther = 0;
  for (const row of containerRows) {
    const bucket = inferContainerBucket(`${row.code ?? ''} ${row.name ?? ''}`.trim());
    if (bucket === 20) size20 += 1;
    else if (bucket === 40) size40 += 1;
    else sizeOther += 1;
  }
  const lclShipments = new Set(lclRows.map((row) => row.shipmentId));
  return {
    totalFclContainers: containerRows.length,
    size20ft: size20,
    size40ft: size40,
    sizeOther,
    lclFulfillments: lclShipments.size,
  };
}

/**
 * One display line per per-container appointment instant so the dispatch
 * master-plan "Giờ:" cell can mirror the CUS workspace contract
 * (`HH:mm dd/mm/yyyy · factory · 1x40HC`). Mirrors the
 * `buildAppointmentGroups` shape from cus-shipment-workspace.service so the
 * two list surfaces stay in sync — the only difference is that here the
 * site name is resolved in a single batched lookup (no per-row trip back to
 * the DB) because the master-plan list view may span dozens of shipments.
 */
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
  allocationStatus?: AllocationStatus;
  /** Dispatch master-plan filter (Lạch Huyện): OR-within pickup/dropoff port ids
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
  // Dispatch master-plan Lạch Huyện facets: OR within each dimension, AND
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
    const idRows = await db.select({ id: s.shipments.id }).from(s.shipments)
      .leftJoin(s.customers, eq(s.shipments.customerId, s.customers.id))
      .where(and(...conditions))
      .orderBy(desc(s.shipments.createdAt));
    const aggregatesById = await loadShipmentDispatchAggregates(idRows.map((row) => row.id));
    const matching = idRows.filter((row) =>
      (aggregatesById.get(row.id)?.allocationStatus ?? 'NOT_ALLOCATED') === options.allocationStatus);
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
    .leftJoin(s.customers, eq(s.shipments.customerId, s.customers.id))
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
        .leftJoin(s.customers, eq(s.shipments.customerId, s.customers.id))
        .leftJoin(s.operationalSites, eq(s.shipments.operationalSiteId, s.operationalSites.id))
        .leftJoin(s.routes, eq(s.shipments.routeId, s.routes.id))
        .where(and(...conditions))
        .orderBy(desc(s.shipments.createdAt));
      const [pageRows, totalRows, filteredIdRows] = await Promise.all([
        paginatedByIds ? pageQuery : pageQuery.limit(limit).offset(offset),
        tx.select({ value: count() }).from(s.shipments)
          .leftJoin(s.customers, eq(s.shipments.customerId, s.customers.id))
          .where(and(...conditions)),
        tx.select({ id: s.shipments.id }).from(s.shipments)
          .leftJoin(s.customers, eq(s.shipments.customerId, s.customers.id))
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
        .leftJoin(s.customers, eq(s.shipments.customerId, s.customers.id))
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
