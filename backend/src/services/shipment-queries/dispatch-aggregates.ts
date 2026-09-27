// Dispatch master-plan aggregates, search predicate and facet builders (card 20260927_145).
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

import { inferContainerBucket, computeContainerAggregates, AllocationStatus, ALLOCATION_STATUSES } from './shared';
import { CUSTOMER_OPERATIONAL_NAME, INTERNAL_FLEET_CARRIER_NAME, activeFulfillment, type ShipmentContainerAggregates } from './shared';
import type { ShipmentCarrierAllocationSummaryEntry } from './container-aggregates';

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
    // Card 20260922_77: the placeholder promises "số container hoặc tờ khai" —
    // mirror the cus-workspace three-branch contract (EXISTS on the child
    // rows; btrim + ILIKE under the same LIKE-escaped pattern).
    sql`exists (
      select 1
      from ${s.shipmentContainers}
      where ${s.shipmentContainers.shipmentId} = ${s.shipments.id}
        and btrim(${s.shipmentContainers.containerNumber}) ilike ${pattern}
    )`,
    sql`exists (
      select 1
      from ${s.shipmentDeclarations}
      where ${s.shipmentDeclarations.shipmentId} = ${s.shipments.id}
        and btrim(${s.shipmentDeclarations.declarationNumber}) ilike ${pattern}
    )`,
  );
}


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
