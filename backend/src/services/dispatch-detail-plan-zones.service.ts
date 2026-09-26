/**
 * Dispatch detail-plan ZONE surfaces: the master-plan per-zone port facet and
 * the detail-plan zone truck-presence panel (plus the zone taxonomy resolver
 * they share). Split out of dispatch-planning-detail-plan.service.ts as the
 * LOC-budget seam (arch-layering 1500-line ceiling, 2026-09-26) — behaviour,
 * semantics, and callers unchanged (routes/dispatch-planning.routes.ts +
 * requireDispatchZone from the detail-plan reader).
 */
import { and, asc, eq, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { TripStatus } from '@tingting/shared';

import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { AuthUser } from '../middleware/auth';
import {
  PORT_OPERATIONAL_NAME,
  addCalendarDays,
  assertDispatchReadActor,
  buildPattern,
  normalizeDate,
  requireAccountantDispatchScope,
} from './dispatch-planning-utils.service';

// ─── Master-plan per-zone port facet (phase-02) ────────────────────────────────

/**
 * Port options for the master-plan zone multi-select: ports whose PERSISTED
 * dispatch_zone equals the requested code. Zone membership is stored
 * authority, never inferred from names at request time. Scoped to the actor
 * like every other dispatch read.
 */

export async function listZonePortFacets(input: { actor: AuthUser; zone: string; q?: string }) {
  assertDispatchReadActor(input.actor);
  const accountantCustomerIds = requireAccountantDispatchScope(input.actor);
  const qPattern = buildPattern(input.q);
  void accountantCustomerIds; // catalog read; actor scoping happens on the row set, not the port list
  // Container-direct like the portIds facet predicate: the master grid lists
  // all statuses and fulfillments only exist from READY_FOR_DISPATCH onward.
  const rows = await db.selectDistinct({ id: s.ports.id, name: PORT_OPERATIONAL_NAME, code: s.ports.code })
    .from(s.shipments)
    .innerJoin(s.shipmentContainers, eq(s.shipmentContainers.shipmentId, s.shipments.id))
    .innerJoin(s.ports, and(
      or(
        eq(s.ports.id, s.shipmentContainers.pickupPortId),
        eq(s.ports.id, s.shipmentContainers.dropoffPortId),
      ),
      eq(s.ports.dispatchZone, input.zone),
      isNull(s.ports.deletedAt),
    ))
    .where(and(
      isNull(s.shipments.deletedAt),
      qPattern ? ilike(s.ports.name, qPattern) : undefined,
    ))
    .orderBy(asc(PORT_OPERATIONAL_NAME))
    .limit(100);
  return { items: rows };
}

// ─── Zone truck presence (detail plan panel) ──────────────────────────────────

/** Evidence that one truck has zone work on a given day. */

export interface ZoneTruckPresenceEvidence {
  reason: 'D-1_DROP' | 'D+1_PICKUP';
  date: string;
  containerNumber: string | null;
  portName: string;
}

/** One truck with its zone evidence around the viewing date. */

export interface ZoneTruckPresenceItem {
  truckId: number;
  plateNumber: string;
  evidence: ZoneTruckPresenceEvidence[];
}

/**
 * Resolve a zone code against the live taxonomy and return its operator label.
 * Unknown/inactive zones are a client error — every zone-scoped surface takes
 * its zone from the /dispatch-zones list, so an unknown code means a stale
 * client, not an empty result.
 */

export async function requireDispatchZone(zone: string): Promise<string> {
  const [row] = await db.select({ label: s.dispatchZones.label })
    .from(s.dispatchZones)
    .where(and(eq(s.dispatchZones.code, zone), eq(s.dispatchZones.isActive, true)))
    .limit(1);
  if (!row) throw new ApiError(400, 'Khu vực điều phối không hợp lệ.');
  return row.label;
}

/**
 * Which OWN trucks have work in `zone` around a viewing date D: a truck that
 * drops a container at a zone port on D-1 (ready for a zone order on D) or
 * picks one up from the zone on D+1 (already committed there). The
 * fleet-picker suggestion engine inverted: instead of tagging trucks for one
 * fulfillment's dropdown, return every truck with evidence for the day being
 * planned.
 *
 * Semantics identical to `buildZoneTruckSuggestions` (single source of truth
 * for plate matching and work-date coalescing): evidence comes from active
 * planned fulfillments joined to zoned ports via containers, matched to owned
 * trucks by normalized plate; workDate = the live trip's departureDate
 * falling back to the shipment's expected delivery date. Advisory only —
 * evidence exposes containerNumber + portName, never customer or shipment.
 */

export async function listZoneTruckPresence(input: { actor: AuthUser; zone: string; date?: string }) {
  assertDispatchReadActor(input.actor);
  // Same accountant scoping as the detail rows this panel sits beside: the
  // evidence exposes container numbers, not just catalog data.
  const accountantCustomerIds = requireAccountantDispatchScope(input.actor);
  const zoneLabel = await requireDispatchZone(input.zone);
  // Default viewing date = today in the dispatch business timezone. 7 =
  // Asia/Ho_Chi_Minh offset (+07, no DST).
  const date = normalizeDate(input.date)
    ?? new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const dayBefore = addCalendarDays(date, -1);
  const dayAfter = addCalendarDays(date, 1);

  // Planned work date: live trip's departure date when present, else the
  // shipment's expected delivery date. Canceled/deleted trips never count.
  const workDateSql = sql<string>`coalesce(${s.trips.departureDate}, ${s.shipments.expectedDeliveryDate})`;

  const evidence = await db.select({
    truckId: s.trucks.id,
    plateNumber: s.trucks.licensePlate,
    // Whether the JOINED LH port is the container's dropoff (vs pickup) —
    // with an OR port join this distinguishes which side matched.
    isDropoff: sql<boolean>`(${s.shipmentContainers.dropoffPortId} = ${s.ports.id})`,
    workDate: workDateSql,
    containerNumber: s.shipmentContainers.containerNumber,
    portName: s.ports.name,
  }).from(s.shipmentFulfillments)
    .innerJoin(s.shipments, eq(s.shipmentFulfillments.shipmentId, s.shipments.id))
    .innerJoin(s.shipmentContainers, eq(s.shipmentFulfillments.shipmentContainerId, s.shipmentContainers.id))
    .innerJoin(s.ports, and(
      or(
        eq(s.shipmentContainers.dropoffPortId, s.ports.id),
        eq(s.shipmentContainers.pickupPortId, s.ports.id),
      ),
      isNull(s.ports.deletedAt),
      eq(s.ports.dispatchZone, input.zone),
    ))
    .innerJoin(s.trucks, eq(
      sql`upper(regexp_replace(${s.trucks.licensePlate}, '[^A-Za-z0-9]', '', 'g'))`,
      sql`upper(regexp_replace(${s.shipmentFulfillments.plannedVehiclePlateNumber}, '[^A-Za-z0-9]', '', 'g'))`,
    ))
    .leftJoin(s.trips, and(
      eq(s.trips.fulfillmentId, s.shipmentFulfillments.id),
      ne(s.trips.status, TripStatus.CANCELED),
      isNull(s.trips.deletedAt),
    ))
    .where(and(
      isNull(s.shipmentFulfillments.canceledAt),
      isNull(s.shipments.deletedAt),
      eq(s.shipmentFulfillments.plannedCarrierType, 'OWN'),
      sql`${s.shipmentFulfillments.plannedVehiclePlateNumber} is not null`,
      accountantCustomerIds ? inArray(s.shipments.customerId, accountantCustomerIds) : undefined,
      // Only D-1 / D+1 work dates can ever produce evidence.
      sql`${workDateSql} in (${dayBefore}, ${dayAfter})`,
    ))
    .limit(500);

  const byTruck = new Map<number, ZoneTruckPresenceItem>();
  for (const row of evidence) {
    const workDay = String(row.workDate).slice(0, 10);
    let reason: ZoneTruckPresenceEvidence['reason'] | null = null;
    // Dropoff in the zone on D-1 → the truck is near the zone the day before.
    if (row.isDropoff && workDay === dayBefore) reason = 'D-1_DROP';
    // Pickup from the zone on D+1 → the truck must be there the day after.
    if (!row.isDropoff && workDay === dayAfter) reason = 'D+1_PICKUP';
    if (reason == null) continue;
    const entry = byTruck.get(row.truckId) ?? {
      truckId: row.truckId,
      plateNumber: row.plateNumber ?? '',
      evidence: [],
    };
    entry.evidence.push({ reason, date: workDay, containerNumber: row.containerNumber, portName: row.portName });
    byTruck.set(row.truckId, entry);
  }

  // Both signals first, then D-1, then D+1; plate tie-break — same merged
  // visible order as the fleet-picker suggestions.
  const rank = (ev: ZoneTruckPresenceEvidence[]) => {
    const hasDrop = ev.some((e) => e.reason === 'D-1_DROP');
    const hasPickup = ev.some((e) => e.reason === 'D+1_PICKUP');
    return hasDrop && hasPickup ? 0 : hasDrop ? 1 : 2;
  };
  const items = [...byTruck.values()]
    .sort((a, b) =>
      rank(a.evidence) - rank(b.evidence)
      || a.plateNumber.localeCompare(b.plateNumber, 'vi'));
  return { date, zone: input.zone, zoneLabel, items };
}
