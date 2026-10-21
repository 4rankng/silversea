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

/** Live master-data contact of the resolved site (REQ-14 sweep, card
 *  211026130743): the same number the driver channel dials as SĐT kho
 *  (driver.service reads the site join live, never a frozen phone). */
export interface FactorySiteContact {
  contactName: string | null;
  contactPhone: string | null;
}

/** The site columns the factory resolution reads. Selecting the contact pair
 *  alongside name/address keeps the read one query — the dispatch write
 *  freezes only name/address while the trip-detail view (GET /api/trips/:id)
 *  forwards the live contact for its tel: link. */
const FACTORY_SITE_COLUMNS = {
  siteName: sql<string>`coalesce(nullif(btrim(${s.operationalSites.shortName}), ''), ${s.operationalSites.name})`,
  siteAddress: s.operationalSites.address,
  siteContactName: s.operationalSites.contactName,
  siteContactPhone: s.operationalSites.contactPhone,
};

function toSnapshot(row: {
  siteName: string;
  siteAddress: string | null;
  siteContactName: string | null;
  siteContactPhone: string | null;
}): FactorySiteSnapshot & FactorySiteContact {
  return {
    name: row.siteName,
    address: row.siteAddress,
    contactName: row.siteContactName,
    contactPhone: row.siteContactPhone,
  };
}

/**
 * Resolve the factory display fields to freeze at dispatch time for one
 * fulfillment. Returns null when nothing factory-like is linked (the trip
 * then keeps null snapshot columns and reads fall back to the live join).
 * The contact pair rides along (live master data) but is NOT frozen — phones
 * are maintained on the site row, so the admin trip detail always dials the
 * current number, exactly like the driver channel.
 */
export async function resolveDispatchFactorySnapshot(
  tx: DbOrTx,
  args: { shipmentId: number; shipmentContainerId: number | null },
): Promise<(FactorySiteSnapshot & FactorySiteContact) | null> {
  const [containerSite] = args.shipmentContainerId == null
    ? []
    : await tx.select(FACTORY_SITE_COLUMNS)
      .from(s.shipmentContainers)
      .innerJoin(s.operationalSites, eq(s.operationalSites.id, s.shipmentContainers.operationalSiteId))
      .where(eq(s.shipmentContainers.id, args.shipmentContainerId))
      .limit(1);
  if (containerSite) return toSnapshot(containerSite);

  const [shipment] = await tx.select({
    operationalSiteId: s.shipments.operationalSiteId,
    factoryName: s.shipments.factoryName,
  })
    .from(s.shipments)
    .where(eq(s.shipments.id, args.shipmentId))
    .limit(1);
  if (shipment?.operationalSiteId != null) {
    const [site] = await tx.select(FACTORY_SITE_COLUMNS)
      .from(s.operationalSites)
      .where(eq(s.operationalSites.id, shipment.operationalSiteId))
      .limit(1);
    if (site) return toSnapshot(site);
  }
  const freeText = shipment?.factoryName?.trim();
  return freeText ? { name: freeText, address: null, contactName: null, contactPhone: null } : null;
}

export interface TripFactorySiteView extends FactorySiteSnapshot, FactorySiteContact {
  /** SNAPSHOT = frozen at dispatch; LIVE = master-data join (legacy rows). */
  source: 'SNAPSHOT' | 'LIVE';
}

/**
 * Read model: prefer the frozen trip columns; when both are null (trip
 * predates migration 0065), resolve against current master data and say so.
 * The contact pair always resolves live (null when no site row or no phone
 * on file) — the FE renders it as the shared TelLink tap-to-call.
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

  // Legacy fallback: resolve live. Reuse the dispatch resolution shape —
  // and always run it when a shipment exists so the SNAPSHOT branch can
  // attach the live contact pair without freezing anything.
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
  const resolved = shipmentId == null
    ? null
    : await resolveDispatchFactorySnapshot(executor, {
      shipmentId,
      shipmentContainerId: containerId,
    });

  if (trip.factorySiteName != null || trip.factorySiteAddress != null) {
    return {
      name: trip.factorySiteName ?? '',
      address: trip.factorySiteAddress,
      contactName: resolved?.contactName ?? null,
      contactPhone: resolved?.contactPhone ?? null,
      source: 'SNAPSHOT',
    };
  }
  return resolved
    ? {
      name: resolved.name,
      address: resolved.address,
      contactName: resolved.contactName,
      contactPhone: resolved.contactPhone,
      source: 'LIVE',
    }
    : null;
}
