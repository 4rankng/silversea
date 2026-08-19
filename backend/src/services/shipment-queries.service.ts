// Shipment Queries Service — read-model aggregates for the shipment list and
// dispatch master-plan views.
//
// Extracted from shipment.service.ts (T3b): pure read-path helpers — container
// 20/40 bucketing, carrier-allocation aggregates, list summaries, and the
// shared search predicate. This module is a LEAF: it imports only db/schema
// and shared lib helpers, never shipment.service, so both the main mutation
// service and future read-side consumers can depend on it without cycles.

import { db } from '../db';
import * as s from '../db/schema';
import { and, asc, desc, eq, ilike, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { localDateInBusinessZone, round2dp, TripStatus } from '@tingting/shared';
import type { Tx } from './trip-shared';
import { escapeLikeTerm } from '../lib/format';
import { operationalName } from '../db/master-data-name';
import type { DispatchCarrierKey, DispatchSummary } from '@tingting/shared';

// Codebase convention: each query service defines its own operational-name
// expression (see driver/gps/dispatch-planning/trip-queries services).
const CUSTOMER_OPERATIONAL_NAME = operationalName(s.customers.shortName, s.customers.name);

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
}

function computeContainerAggregates(
  containers: Array<{ containerTypeCode: string | null; containerTypeName: string | null; cargoWeightKg: string | null }>,
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
  };
}

export interface ShipmentCarrierAllocationSummaryEntry {
  carrierType: 'OWN' | 'EXTERNAL';
  externalCarrierId: number | null;
  carrierLabel: string;
  count20: number;
  count40: number;
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
  if (shipment.cargoMode === 'LCL') {
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
      id: s.trips.id,
      shipmentId: s.trips.shipmentId,
      fulfillmentId: s.trips.fulfillmentId,
      carrierType: s.trips.carrierType,
      truckPlate: s.trucks.licensePlate,
      externalCarrierName: CUSTOMER_OPERATIONAL_NAME,
      externalPlateNumber: s.trips.externalPlateNumber,
    }).from(s.trips)
      .leftJoin(s.trucks, and(
        eq(s.trucks.id, s.trips.truckId),
        isNull(s.trucks.deletedAt),
      ))
      .leftJoin(s.customers, and(
        eq(s.customers.id, s.trips.externalEntityId),
        eq(s.trips.externalEntityType, 'CUSTOMER'),
        isNull(s.customers.deletedAt),
      ))
      .where(and(
        inArray(s.trips.shipmentId, shipmentIds),
        isNull(s.trips.deletedAt),
        ne(s.trips.status, TripStatus.CANCELED),
      ))
      .orderBy(asc(s.trips.shipmentId), asc(s.trips.id)),
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
): Promise<DispatchSummary> {
  const ids = [...new Set(shipmentIds)];
  if (ids.length === 0) {
    return { totalFclContainers: 0, size20ft: 0, size40ft: 0, sizeOther: 0, lclFulfillments: 0 };
  }
  const [containerRows, lclRows] = await Promise.all([
    tx.select({
      shipmentId: s.shipmentContainers.shipmentId,
      code: s.containerTypes.code,
      name: s.containerTypes.name,
    }).from(s.shipmentContainers)
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
  /** Effective factory name resolved through the SILVER L1 precedence chain;
   *  null when the lot has no factory information at any level. */
  factoryName: string | null;
  /** Compact per-type container summary, e.g. "1 x 40DC + 1 x 20DC". */
  containerSummary: string;
}

export async function loadShipmentListAppointmentGroups(
  shipments: Array<typeof s.shipments.$inferSelect>,
): Promise<Map<number, ShipmentAppointmentGroup[]>> {
  const result = new Map<number, ShipmentAppointmentGroup[]>();
  const ids = [...new Set(shipments.map((shipment) => shipment.id))];
  if (ids.length === 0) return result;

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

  // Resolve every distinct operational site id in one query — avoids N+1
  // and is bounded by the page size (≤200 shipments × 1-3 sites per lot).
  const siteIds = [...new Set(containerRows
    .map((row) => row.operationalSiteId)
    .filter((id): id is number => id != null))];
  const sitesById = siteIds.length === 0
    ? new Map<number, string | null>()
    : new Map((await db.select({ id: s.operationalSites.id, name: s.operationalSites.name })
      .from(s.operationalSites)
      .where(inArray(s.operationalSites.id, siteIds)))
      .map((row) => [row.id, row.name]));

  // Group by shipment, then by (instant, factoryName) so two containers with
  // the same appointment instant and factory collapse into one cell line.
  type Bucket = { at: string; localDate: string; factoryName: string | null; typeCounts: Map<string, number> };
  const byShipment = new Map<number, Map<string, Bucket>>();
  for (const row of containerRows) {
    const at = row.customerAppointmentAt;
    if (at == null) continue;
    // SILVER L1 precedence: container site → shipment site → shipment factory text.
    const factoryName = row.operationalSiteId != null
      ? sitesById.get(row.operationalSiteId) ?? null
      : null;
    const atIso = at.toISOString();
    const key = `${atIso}|${factoryName ?? ''}`;
    let shipmentBuckets = byShipment.get(row.shipmentId);
    if (!shipmentBuckets) {
      shipmentBuckets = new Map();
      byShipment.set(row.shipmentId, shipmentBuckets);
    }
    const existing = shipmentBuckets.get(key);
    const typeLabel = row.containerTypeCode ?? row.containerTypeName ?? 'container';
    if (existing) {
      existing.typeCounts.set(typeLabel, (existing.typeCounts.get(typeLabel) ?? 0) + 1);
    } else {
      const localDate = localDateInBusinessZone(at) ?? '0000-00-00';
      shipmentBuckets.set(key, {
        at: atIso,
        localDate,
        factoryName,
        typeCounts: new Map([[typeLabel, 1]]),
      });
    }
  }

  // Augment groups with the shipment-level factory fallback (SILVER L1 last
  // tier) for lots where the container row had no site link.
  const shipmentsById = new Map(shipments.map((ship) => [ship.id, ship]));
  for (const [shipmentId, buckets] of byShipment) {
    const ship = shipmentsById.get(shipmentId);
    const shipFactoryName = ship?.factoryName?.trim() || null;
    const shipSiteId = ship?.operationalSiteId ?? null;
    const resolvedGroups: ShipmentAppointmentGroup[] = [];
    for (const bucket of buckets.values()) {
      let factoryName = bucket.factoryName;
      if (factoryName == null) {
        if (shipSiteId != null) {
          factoryName = sitesById.get(shipSiteId)
            ?? (shipFactoryName ?? null);
        } else {
          factoryName = shipFactoryName ?? null;
        }
      }
      const containerSummary = [...bucket.typeCounts.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([code, count]) => `${count} x ${code}`)
        .join(' + ') || '—';
      resolvedGroups.push({
        at: bucket.at,
        localDate: bucket.localDate,
        factoryName,
        containerSummary,
      });
    }
    // Earliest-first, then factory name (mirrors the CUS workspace contract).
    resolvedGroups.sort((a, b) => a.at.localeCompare(b.at)
      || (a.factoryName ?? '').localeCompare(b.factoryName ?? ''));
    result.set(shipmentId, resolvedGroups);
  }
  return result;
}
