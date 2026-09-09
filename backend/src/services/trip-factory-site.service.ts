// Trip factory-site snapshot (F6, MasterDataNhaMay MDN-13).
//
// `trips.route_id` already snapshots the route; these helpers complete the
// same doctrine for the factory's operational display fields: the dispatch
// write path freezes the site name + address onto the trip, and reads prefer
// the frozen columns — falling back to the live master-data join only when
// the snapshot columns are null (legacy trips created before migration 0065).
//
// Resolution priority mirrors the shipment-detail `effectiveFactoryName`
// rule: the fulfillment's own container site beats the shipment-level site,
// and the shipment's free-text factory name is the last resort (no address
// to snapshot in that case).
import { db } from '../db';
import * as s from '../db/schema';
import { eq, sql } from 'drizzle-orm';
import type { Tx } from './trip-shared';

type DbOrTx = typeof db | Tx;

export interface FactorySiteSnapshot {
  name: string;
  address: string | null;
}

/**
 * Resolve the factory display fields to freeze at dispatch time for one
 * fulfillment. Returns null when nothing factory-like is linked (the trip
 * then keeps null snapshot columns and reads fall back to the live join).
 */
export async function resolveDispatchFactorySnapshot(
  tx: DbOrTx,
  args: { shipmentId: number; shipmentContainerId: number | null },
): Promise<FactorySiteSnapshot | null> {
  const [containerSite] = args.shipmentContainerId == null
    ? []
    : await tx.select({
      siteName: sql<string>`coalesce(nullif(btrim(${s.operationalSites.shortName}), ''), ${s.operationalSites.name})`,
      siteAddress: s.operationalSites.address,
    })
      .from(s.shipmentContainers)
      .innerJoin(s.operationalSites, eq(s.operationalSites.id, s.shipmentContainers.operationalSiteId))
      .where(eq(s.shipmentContainers.id, args.shipmentContainerId))
      .limit(1);
  if (containerSite) return { name: containerSite.siteName, address: containerSite.siteAddress };

  const [shipment] = await tx.select({
    operationalSiteId: s.shipments.operationalSiteId,
    factoryName: s.shipments.factoryName,
  })
    .from(s.shipments)
    .where(eq(s.shipments.id, args.shipmentId))
    .limit(1);
  if (shipment?.operationalSiteId != null) {
    const [site] = await tx.select({
      siteName: sql<string>`coalesce(nullif(btrim(${s.operationalSites.shortName}), ''), ${s.operationalSites.name})`,
      siteAddress: s.operationalSites.address,
    })
      .from(s.operationalSites)
      .where(eq(s.operationalSites.id, shipment.operationalSiteId))
      .limit(1);
    if (site) return { name: site.siteName, address: site.siteAddress };
  }
  const freeText = shipment?.factoryName?.trim();
  return freeText ? { name: freeText, address: null } : null;
}

export interface TripFactorySiteView extends FactorySiteSnapshot {
  /** SNAPSHOT = frozen at dispatch; LIVE = master-data join (legacy rows). */
  source: 'SNAPSHOT' | 'LIVE';
}

/**
 * Read model: prefer the frozen trip columns; when both are null (trip
 * predates migration 0065), resolve against current master data and say so.
 */
export async function getTripFactorySiteView(
  tripId: number,
  executor: DbOrTx = db,
): Promise<TripFactorySiteView | null> {
  const [trip] = await executor.select({
    id: s.trips.id,
    shipmentId: s.trips.shipmentId,
    fulfillmentId: s.trips.fulfillmentId,
    factorySiteName: s.trips.factorySiteName,
    factorySiteAddress: s.trips.factorySiteAddress,
  })
    .from(s.trips)
    .where(eq(s.trips.id, tripId))
    .limit(1);
  if (!trip) return null;
  if (trip.factorySiteName != null || trip.factorySiteAddress != null) {
    return {
      name: trip.factorySiteName ?? '',
      address: trip.factorySiteAddress,
      source: 'SNAPSHOT',
    };
  }

  // Legacy fallback: resolve live. Reuse the dispatch resolution shape.
  let containerId: number | null = null;
  let shipmentId = trip.shipmentId;
  if (trip.fulfillmentId != null) {
    const [fulfillment] = await executor.select({
      shipmentId: s.shipmentFulfillments.shipmentId,
      shipmentContainerId: s.shipmentFulfillments.shipmentContainerId,
    })
      .from(s.shipmentFulfillments)
      .where(eq(s.shipmentFulfillments.id, trip.fulfillmentId))
      .limit(1);
    if (fulfillment) {
      shipmentId = fulfillment.shipmentId;
      containerId = fulfillment.shipmentContainerId;
    }
  }
  if (shipmentId == null) return null;
  const resolved = await resolveDispatchFactorySnapshot(executor, {
    shipmentId,
    shipmentContainerId: containerId,
  });
  return resolved ? { ...resolved, source: 'LIVE' } : null;
}
