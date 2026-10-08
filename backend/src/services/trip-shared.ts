// Trip Shared — Types and helpers used across trip sub-modules

import type { Executor, Tx } from '../db';
import * as s from '../db/schema';
import { isNull, eq, and, inArray, asc, sql } from 'drizzle-orm';
import { operationalName } from '../db/master-data-name';

// Canonical database-handle types live in ../db (the one Executor seam).
// Re-exported here for the trip-family modules that already import Tx from
// trip-shared; import from ../db in new code.
export type { Executor, Tx };

/**
 * Resolve the active trailer for a truck's currentTrailerId.
 * Returns null for both fields if no trailer is linked or the trailer is soft-deleted.
 */
export async function resolveTrailer(
  tx: Tx,
  currentTrailerId: number | null,
): Promise<{ trailerId: number | null; trailerType: string | null }> {
  if (!currentTrailerId) return { trailerId: null, trailerType: null };
  const [trailer] = await tx.select().from(s.trailers)
    .where(and(eq(s.trailers.id, currentTrailerId), isNull(s.trailers.deletedAt)))
    .limit(1);
  if (trailer) {
    return { trailerId: trailer.id, trailerType: trailer.type };
  }
  return { trailerId: null, trailerType: null };
}

// ── Canonical trip locations (card 353) ─────────────────────────────────────
// trips.canonical_origin / canonical_destination carry the trip's điểm đi /
// điểm đến (the container's Cảng nâng / Cảng hạ). Dispatch issuance writes the
// columns at order time; trips issued before that write landed (staging census
// trips 131-134 and older) coalesce from the source container through
// resolveCanonicalLocationsForTrips so every pairing reader (FE draftFor feed
// getTripById, pair authority loadTripsForPairing) agrees on one authority.

export interface TripCanonicalLocations {
  origin: string | null;
  destination: string | null;
}

export interface ContainerLocationRow {
  pickupPortName: string | null;
  dropoffPortName: string | null;
  rawPickupPortName: string | null;
  rawDropoffPortName: string | null;
}

const PORT_OPERATIONAL_NAME = operationalName(s.ports.shortName, s.ports.name);

/**
 * Select shape for the container-side location authority — spread into a
 * select FROM shipment_containers (the port name subqueries correlate on it).
 * Preference: catalog port operational name (shortName over name), then the
 * ad-hoc free-text raw name; trimmed and bounded to the varchar(160) columns.
 */
export const containerLocationColumns = {
  pickupPortName: sql<string | null>`(select ${PORT_OPERATIONAL_NAME} from ${s.ports} where ${s.ports.id} = ${s.shipmentContainers.pickupPortId})`,
  dropoffPortName: sql<string | null>`(select ${PORT_OPERATIONAL_NAME} from ${s.ports} where ${s.ports.id} = ${s.shipmentContainers.dropoffPortId})`,
  rawPickupPortName: s.shipmentContainers.rawPickupPortName,
  rawDropoffPortName: s.shipmentContainers.rawDropoffPortName,
};

function locationLabel(portName: string | null, rawName: string | null): string | null {
  const candidate = portName?.trim() || rawName?.trim() || null;
  return candidate ? candidate.slice(0, 160) : null;
}

export function canonicalLocationsFromContainerRow(row: ContainerLocationRow): TripCanonicalLocations {
  return {
    origin: locationLabel(row.pickupPortName, row.rawPickupPortName),
    destination: locationLabel(row.dropoffPortName, row.rawDropoffPortName),
  };
}

/** Locations for one shipment container (the dispatch-issue write path). */
export async function resolveCanonicalLocationsForContainer(
  executor: Executor,
  shipmentContainerId: number | null,
): Promise<TripCanonicalLocations> {
  if (shipmentContainerId == null) return { origin: null, destination: null };
  const [row] = await executor.select(containerLocationColumns)
    .from(s.shipmentContainers)
    .where(eq(s.shipmentContainers.id, shipmentContainerId))
    .limit(1);
  return row ? canonicalLocationsFromContainerRow(row) : { origin: null, destination: null };
}

/**
 * Per-trip location fallback for trips whose canonical columns are still null.
 * Primary: the fulfillment's shipment container (dispatch-issued trips).
 * Fallback: the trip_containers snapshot link (sourceShipmentContainerId) for
 * rows whose fulfillment link is missing or port-less — first snapshot row per
 * trip wins (deterministic by lowest id), matching loadPairingContainerInfo.
 */
export async function resolveCanonicalLocationsForTrips(
  executor: Executor,
  tripIds: number[],
): Promise<Map<number, TripCanonicalLocations>> {
  const result = new Map<number, TripCanonicalLocations>();
  if (tripIds.length === 0) return result;

  const viaFulfillment = await executor.select({
    tripId: s.trips.id,
    ...containerLocationColumns,
  })
    .from(s.trips)
    .innerJoin(s.shipmentFulfillments, eq(s.shipmentFulfillments.id, s.trips.fulfillmentId))
    .innerJoin(s.shipmentContainers, eq(s.shipmentContainers.id, s.shipmentFulfillments.shipmentContainerId))
    .where(inArray(s.trips.id, tripIds));
  for (const row of viaFulfillment) {
    result.set(row.tripId, canonicalLocationsFromContainerRow(row));
  }

  const stillMissing = tripIds.filter((tripId) => {
    const resolved = result.get(tripId);
    return resolved == null || (resolved.origin == null && resolved.destination == null);
  });
  if (stillMissing.length > 0) {
    const viaSnapshot = await executor.select({
      tripId: s.tripContainers.tripId,
      ...containerLocationColumns,
    })
      .from(s.tripContainers)
      .innerJoin(s.shipmentContainers, eq(s.shipmentContainers.id, s.tripContainers.sourceShipmentContainerId))
      .where(inArray(s.tripContainers.tripId, stillMissing))
      .orderBy(asc(s.tripContainers.id));
    for (const row of viaSnapshot) {
      const resolved = result.get(row.tripId);
      const snapshot = canonicalLocationsFromContainerRow(row);
      result.set(row.tripId, {
        origin: resolved?.origin ?? snapshot.origin,
        destination: resolved?.destination ?? snapshot.destination,
      });
    }
  }
  return result;
}
