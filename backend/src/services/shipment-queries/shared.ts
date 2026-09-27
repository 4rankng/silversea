// Shared anchors for the shipment-queries read models (card 20260927_145 split).
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

export const CUSTOMER_OPERATIONAL_NAME = operationalName(s.customers.shortName, s.customers.name);
export const SITE_OPERATIONAL_NAME = operationalName(s.operationalSites.shortName, s.operationalSites.name);
export const ROUTE_OPERATIONAL_NAME = operationalName(s.routes.shortName, s.routes.name);

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
export function inferContainerBucket(label: string | null | undefined): 20 | 40 | null {
  const normalized = (label ?? '').toUpperCase().trim();
  if (/^20(?:\D|$)/.test(normalized)) return 20;
  if (/^40(?:\D|$)/.test(normalized)) return 40;
  return null;
}

export interface ShipmentContainerAggregates {
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

export function computeContainerAggregates(
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


export const INTERNAL_FLEET_CARRIER_NAME = 'SilverSea';

export const activeFulfillment = () => isNull(s.shipmentFulfillments.canceledAt);
