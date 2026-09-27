// Shipment list container port-group + carrier-allocation aggregates (card 20260927_145).
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

import { inferContainerBucket, computeContainerAggregates, AllocationStatus, ALLOCATION_STATUSES, CUSTOMER_OPERATIONAL_NAME, SITE_OPERATIONAL_NAME, ROUTE_OPERATIONAL_NAME } from './shared';

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
