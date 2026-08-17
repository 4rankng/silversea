import { eq, ne, and, isNull, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import * as schema from '../db/schema';
import { operationalName } from '../db/master-data-name';
import { cacheGet } from '../lib/redis';
import { TripStatus } from '@tingting/shared';
import type { LiveFleetLeg, LiveFleetResponse, LiveFleetVehicle } from '@tingting/shared';
import { getGpsProvider } from './gps/providers';
import type { NormalizedGpsVehicle } from './gps/providers/types';
import { normalizePlate, isStale, deriveStatus, reviveDate } from './gps/parse';
import { resolveRoute, decodePolyline } from './gps/route-capture';
import { fetchRouteMap } from './gps/route-lookup';
import { getAppSettings } from './app-settings.service';

const CUSTOMER_OPERATIONAL_NAME = operationalName(schema.customers.shortName, schema.customers.name);
const ROUTE_OPERATIONAL_NAME = operationalName(schema.routes.shortName, schema.routes.name);

// Re-export the pure helpers (consumed by unit tests and the providers).
export { normalizePlate, parseBachKhoaDate, parseAspDate, isStale, deriveStatus, reviveDate } from './gps/parse';

/**
 * Live vehicle tracking via the Bách Khoa GPS provider (dvbk.vn).
 *
 * Two interchangeable sources sit behind `getGpsProvider()` (see ./gps/providers):
 * the documented public API and the web-portal endpoint. "Real-time" is poll
 * cadence — a pull-through Redis cache (`cacheGet`) fronts the active provider so
 * N concurrent viewers collapse to ≤1 upstream call per TTL window. Credentials
 * are server-side only and never reach the client.
 */

/**
 * Fetch the planned legs (with GPS-captured route polylines) for the given trips,
 * so the dispatch map can draw the remaining route to each truck's destination.
 * Mirrors the polyline attachment in trip-queries.service.ts (route_polylines).
 */
async function fetchLegsWithRoutes(tripIds: number[]): Promise<Map<number, LiveFleetLeg[]>> {
  const byTrip = new Map<number, LiveFleetLeg[]>();
  if (tripIds.length === 0) return byTrip;

  const legs = await db
    .select({
      tripId: schema.tripLegs.tripId,
      sequence: schema.tripLegs.sequence,
      origin: schema.tripLegs.origin,
      destination: schema.tripLegs.destination,
      loadingType: schema.tripLegs.loadingType,
    })
    .from(schema.tripLegs)
    .where(inArray(schema.tripLegs.tripId, tripIds))
    .orderBy(schema.tripLegs.tripId, schema.tripLegs.sequence);

  // Routes (bidirectional: A→B also covers B→A reversed) for each leg.
  const byPair = await fetchRouteMap(legs);

  for (const l of legs) {
    const route = resolveRoute(byPair, l.origin, l.destination);
    const arr = byTrip.get(l.tripId) ?? [];
    arr.push({
      sequence: l.sequence,
      origin: l.origin,
      destination: l.destination,
      loadingType: l.loadingType as LiveFleetLeg['loadingType'],
      polylinePath: route?.polyline ?? null,
    });
    byTrip.set(l.tripId, arr);
  }
  return byTrip;
}

const GPS_CACHE_KEY = 'gps:live';
const GPS_CACHE_TTL_SECONDS = 10;

// ─── Last-known position persistence + offline fallback ──────────────────────

/** One active IN_TRANSIT trip joined to its truck/driver/customer/route. */
export interface ActiveTripRow {
  tripId: number;
  tripCode: string | null;
  truckId: number;
  licensePlate: string;
  driverName: string | null;
  customerName: string | null;
  routeName: string | null;
}

/** A persisted last-known fix for a truck (from vehicle_last_positions). */
export interface LastKnownPosition {
  truckId: number;
  deviceId: string | null;
  lat: number | null;
  lng: number | null;
  speed: number | null;
  angle: number | null;
  address: string | null;
  ignitionOn: boolean;
  fuel: number | null;
  gpsDriverName: string | null;
  lastSeenAt: Date | null;
}

/** A live fix to upsert into vehicle_last_positions. */
interface PositionRow {
  truckId: number;
  deviceId: string | null;
  lat: number;
  lng: number;
  speed: number;
  angle: number;
  address: string | null;
  ignitionOn: boolean;
  fuel: number | null;
  gpsDriverName: string | null;
  lastSeenAt: Date | null;
}

/** Compose-fleet result. `persist` holds the fresh live fixes to upsert. */
interface ComposeResult {
  vehicles: LiveFleetVehicle[];
  stale: boolean;
  error?: string;
  persist: PositionRow[];
}

/** Map a built live vehicle to its vehicle_last_positions upsert row. */
function toPositionRow(v: LiveFleetVehicle): PositionRow {
  return {
    truckId: v.truckId,
    deviceId: v.deviceId,
    lat: v.lat,
    lng: v.lng,
    speed: v.speed,
    angle: v.angle,
    address: v.address,
    ignitionOn: v.ignitionOn,
    fuel: v.fuel,
    gpsDriverName: v.gpsDriverName,
    lastSeenAt: v.lastSeenAt ? new Date(v.lastSeenAt) : null,
  };
}

/** Active IN_TRANSIT trips with their truck/driver/customer/route context. */
async function loadActiveTrips(): Promise<ActiveTripRow[]> {
  return db
    .select({
      tripId: schema.trips.id,
      tripCode: schema.trips.tripCode,
      truckId: schema.trucks.id,
      licensePlate: schema.trucks.licensePlate,
      driverName: schema.drivers.name,
      customerName: CUSTOMER_OPERATIONAL_NAME,
      routeName: ROUTE_OPERATIONAL_NAME,
    })
    .from(schema.trips)
    .innerJoin(schema.trucks, eq(schema.trips.truckId, schema.trucks.id))
    .leftJoin(schema.drivers, eq(schema.trips.driverId, schema.drivers.id))
    .leftJoin(schema.customers, eq(schema.trips.customerId, schema.customers.id))
    .leftJoin(schema.routes, eq(schema.trips.routeId, schema.routes.id))
    .where(and(eq(schema.trips.status, TripStatus.IN_TRANSIT), isNull(schema.trips.deletedAt)));
}

/** Last-known position per truckId (the offline-fallback source). */
async function loadLastKnownPositions(truckIds: number[]): Promise<Map<number, LastKnownPosition>> {
  const map = new Map<number, LastKnownPosition>();
  if (truckIds.length === 0) return map;
  const rows = await db
    .select()
    .from(schema.vehicleLastPositions)
    .where(inArray(schema.vehicleLastPositions.truckId, truckIds));
  for (const r of rows) {
    map.set(r.truckId, {
      truckId: r.truckId,
      deviceId: r.deviceId,
      lat: r.lat,
      lng: r.lng,
      speed: r.speed,
      angle: r.angle,
      address: r.address,
      ignitionOn: r.ignitionOn,
      fuel: r.fuel,
      gpsDriverName: r.gpsDriverName,
      lastSeenAt: r.lastSeenAt,
    });
  }
  return map;
}

/** Bulk-upsert fresh live fixes (1:1 per truck on the truck_id primary key). */
async function persistLastPositions(rows: PositionRow[]): Promise<void> {
  if (rows.length === 0) return;
  await db
    .insert(schema.vehicleLastPositions)
    .values(rows)
    .onConflictDoUpdate({
      target: schema.vehicleLastPositions.truckId,
      set: {
        deviceId: sql`excluded.device_id`,
        lat: sql`excluded.lat`,
        lng: sql`excluded.lng`,
        speed: sql`excluded.speed`,
        angle: sql`excluded.angle`,
        address: sql`excluded.address`,
        ignitionOn: sql`excluded.ignition_on`,
        fuel: sql`excluded.fuel`,
        gpsDriverName: sql`excluded.gps_driver_name`,
        lastSeenAt: sql`excluded.last_seen_at`,
        updatedAt: new Date(),
      },
      // Fresher-wins: never let a stale fix overwrite a newer persisted position.
      // Guards the overview path — the provider may re-emit an old breadcrumb for a
      // parked truck — and is a no-op for the active-trip path, whose live fixes are
      // always current.
      where: sql`excluded.last_seen_at IS NOT NULL AND (vehicle_last_positions.last_seen_at IS NULL OR excluded.last_seen_at >= vehicle_last_positions.last_seen_at)`,
    });
}

// ─── Fleet overview (all trucks, not just active trips) ──────────────────────

interface TripContext {
  tripId: number;
  tripCode: string | null;
  driverName: string | null;
  customerName: string | null;
  routeName: string | null;
}

/** All non-deleted trucks — the fleet shown on the dispatch map. */
async function loadAllTrucks(): Promise<Array<{ id: number; licensePlate: string }>> {
  return db
    .select({ id: schema.trucks.id, licensePlate: schema.trucks.licensePlate })
    .from(schema.trucks)
    .where(isNull(schema.trucks.deletedAt));
}

/** Most-recent trip per truck (context for the marker popup). Latest = highest trip id. */
async function loadRecentTripsByTruck(truckIds: number[]): Promise<Map<number, TripContext>> {
  const map = new Map<number, TripContext>();
  if (truckIds.length === 0) return map;
  const rows = await db
    .select({
      truckId: schema.trips.truckId,
      tripId: schema.trips.id,
      tripCode: schema.trips.tripCode,
      driverName: schema.drivers.name,
      customerName: CUSTOMER_OPERATIONAL_NAME,
      routeName: ROUTE_OPERATIONAL_NAME,
    })
    .from(schema.trips)
    .leftJoin(schema.drivers, eq(schema.trips.driverId, schema.drivers.id))
    .leftJoin(schema.customers, eq(schema.trips.customerId, schema.customers.id))
    .leftJoin(schema.routes, eq(schema.trips.routeId, schema.routes.id))
    // Exclude CANCELED: a canceled trip's higher serial id would otherwise displace
    // the truck's real last trip as the "recent trip" popup context. CREATED trips
    // are kept (they are valid upcoming assignments).
    .where(and(
      inArray(schema.trips.truckId, truckIds),
      isNull(schema.trips.deletedAt),
      ne(schema.trips.status, TripStatus.CANCELED),
    ));
  for (const r of rows) {
    if (r.truckId == null) continue;
    const cur = map.get(r.truckId);
    if (!cur || r.tripId > cur.tripId) {
      map.set(r.truckId, {
        tripId: r.tripId,
        tripCode: r.tripCode,
        driverName: r.driverName,
        customerName: r.customerName,
        routeName: r.routeName,
      });
    }
  }
  return map;
}

/**
 * Last-known location per truck: the persisted live fix when present, otherwise
 * the endpoint of the most-recent captured GPS trail (decoded). Returns only
 * trucks with a resolvable location — powers the fleet-overview fallback so the
 * dispatch map stays populated even when no trip is in-transit.
 */
async function loadLastKnownAll(truckIds: number[]): Promise<Map<number, LastKnownPosition>> {
  const map = new Map<number, LastKnownPosition>();
  if (truckIds.length === 0) return map;

  const persisted = await loadLastKnownPositions(truckIds);
  for (const [id, pos] of persisted) {
    if (pos.lat != null && pos.lng != null) map.set(id, pos);
  }

  const missing = truckIds.filter((id) => !map.has(id));
  if (missing.length === 0) return map;

  const trails = await db
    .select({
      truckId: schema.tripGpsTracks.truckId,
      encodedPolyline: schema.tripGpsTracks.encodedPolyline,
      endedAt: schema.tripGpsTracks.endedAt,
      capturedAt: schema.tripGpsTracks.capturedAt,
    })
    .from(schema.tripGpsTracks)
    .where(inArray(schema.tripGpsTracks.truckId, missing));
  // Pick the latest trail per truck by captured_at (NOT NULL), NOT ended_at — ended_at
  // is nullable, so a newer partial/failed capture (ended_at NULL) would otherwise lose
  // to an older timestamped trail and place the marker at a stale position.
  const latest = new Map<number, { poly: string; ts: number; endedAt: Date | null }>();
  for (const t of trails) {
    if (t.truckId == null) continue;
    const ts = t.capturedAt.getTime();
    const cur = latest.get(t.truckId);
    if (!cur || ts > cur.ts) latest.set(t.truckId, { poly: t.encodedPolyline, ts, endedAt: t.endedAt });
  }
  for (const [truckId, { poly, endedAt }] of latest) {
    const pts = decodePolyline(poly);
    if (pts.length === 0) continue;
    const last = pts[pts.length - 1];
    map.set(truckId, {
      truckId,
      deviceId: null,
      lat: last[0],
      lng: last[1],
      speed: 0,
      angle: 0,
      address: null,
      ignitionOn: false,
      fuel: null,
      gpsDriverName: null,
      lastSeenAt: endedAt,
    });
  }
  return map;
}

/**
 * Pure composition: merge live provider fixes with last-known fallback into the
 * fleet payload. No I/O — exported so it can be unit-tested with plain objects.
 *
 * Live fixes matched to an active trip keep their derived status; active trips
 * the provider did NOT cover are filled from last-known positions as
 * status:'offline', stale:true (an honest "last seen" instead of vanishing).
 *
 * Error semantics drive the frontend amber banner (checked before vehicles): no
 * error whenever vehicles exist; error only when there are active trips, the
 * provider is unavailable, AND we have no last-known position for any of them.
 */
export function composeFleet(args: {
  activeTrips: ActiveTripRow[];
  /** Provider fixes; `null` means the provider call failed (down/misconfigured). */
  providerVehicles: NormalizedGpsVehicle[] | null;
  providerError?: string | null;
  lastKnown: Map<number, LastKnownPosition>;
  legsByTrip: Map<number, LiveFleetLeg[]>;
  now: Date;
}): ComposeResult {
  const { activeTrips, providerVehicles, providerError, lastKnown, legsByTrip, now } = args;

  const byPlate = new Map<string, ActiveTripRow>();
  for (const t of activeTrips) byPlate.set(normalizePlate(t.licensePlate), t);

  const vehicles: LiveFleetVehicle[] = [];
  const persist: PositionRow[] = [];
  const covered = new Set<number>();

  // Live: match provider fixes to active trips.
  if (providerVehicles) {
    for (const g of providerVehicles) {
      const trip = byPlate.get(normalizePlate(g.numberPlate));
      if (!trip) continue;
      covered.add(trip.truckId);
      const stale = isStale(g.lastSeenAt, now);
      const v: LiveFleetVehicle = {
        truckId: trip.truckId,
        licensePlate: trip.licensePlate,
        deviceId: g.deviceId,
        lat: g.lat,
        lng: g.lng,
        speed: g.speed,
        angle: g.angle,
        address: g.address,
        status: deriveStatus(stale, g.lostSignal, g.speed),
        ignitionOn: g.ignitionOn,
        fuel: g.fuel,
        gpsDriverName: g.driverName,
        lastSeenAt: g.lastSeenAt ? g.lastSeenAt.toISOString() : '',
        stale,
        tripId: trip.tripId,
        tripCode: trip.tripCode,
        driverName: trip.driverName,
        customerName: trip.customerName,
        routeName: trip.routeName,
        legs: legsByTrip.get(trip.tripId) ?? [],
        details: g.details ?? null,
      };
      vehicles.push(v);
      persist.push(toPositionRow(v));
    }
  }

  // Fallback: active trips the provider didn't cover → last-known, shown offline.
  for (const trip of activeTrips) {
    if (covered.has(trip.truckId)) continue;
    const pos = lastKnown.get(trip.truckId);
    if (!pos || pos.lat == null || pos.lng == null) continue;
    vehicles.push({
      truckId: trip.truckId,
      licensePlate: trip.licensePlate,
      deviceId: pos.deviceId,
      lat: pos.lat,
      lng: pos.lng,
      speed: pos.speed ?? 0,
      angle: pos.angle ?? 0,
      address: pos.address,
      status: 'offline',
      ignitionOn: pos.ignitionOn,
      fuel: pos.fuel,
      gpsDriverName: pos.gpsDriverName,
      lastSeenAt: pos.lastSeenAt ? pos.lastSeenAt.toISOString() : '',
      stale: true,
      tripId: trip.tripId,
      tripCode: trip.tripCode,
      driverName: trip.driverName,
      customerName: trip.customerName,
      routeName: trip.routeName,
      legs: legsByTrip.get(trip.tripId) ?? [],
      details: null,
    });
  }

  // Error only on genuine emptiness: active trips exist but the provider is
  // unavailable and we have nothing to show for any of them.
  let error: string | undefined;
  if (vehicles.length === 0 && activeTrips.length > 0) {
    if (providerVehicles === null) error = providerError || 'GPS provider unavailable';
    else if (providerVehicles.length === 0) error = 'GPS provider returned no vehicles';
  }

  return {
    vehicles,
    stale: vehicles.length > 0 && vehicles.every((v) => v.stale),
    error,
    persist,
  };
}

/**
 * Build the live-fleet payload — a dispatch overview of EVERY truck, not just
 * those on an active trip. For trucks on an active IN_TRANSIT trip, live provider
 * fixes are joined in (last-known shown offline when the provider is down/omits
 * them). Trucks not on an active trip are still shown at their last-known location
 * (persisted live fix, else the endpoint of the most-recent captured GPS trail),
 * so the map is never blank. Always returns a well-formed response — never throws.
 */
export async function getLiveFleet(): Promise<LiveFleetResponse> {
  const fetchedAt = new Date().toISOString();
  const now = new Date();

  // Admin kill-switch: when the Bách Khoa feature is off, expose no fleet data
  // at all — no live fixes, no last-known fallback, no map markers. The empty
  // payload hides every GPS-derived component on the dispatch + trip-detail UIs.
  const { gpsEnabled } = await getAppSettings();
  if (!gpsEnabled) {
    return { vehicles: [], stale: false, fetchedAt };
  }

  // Active trips first — needed for both the live join and the fallback, so the
  // original provider-down short-circuits no longer blank the map.
  const activeTrips = await loadActiveTrips();

  // Upstream provider call (cached). `null` = provider failed; `[]` = provider
  // up but returned nothing. Either way the fallback can still populate the map.
  let providerVehicles: NormalizedGpsVehicle[] | null = null;
  let providerError: string | null = null;
  const provider = getGpsProvider();
  try {
    if (!(await provider.isConfigured())) {
      providerError = 'GPS provider not configured';
    } else {
      providerVehicles = await cacheGet<NormalizedGpsVehicle[]>(
        GPS_CACHE_KEY,
        GPS_CACHE_TTL_SECONDS,
        () => provider.fetchVehicles(),
      );
      // The pull-through cache round-trips through Redis JSON, flattening
      // `lastSeenAt: Date` to an ISO string on a cache hit. Revive it back to a
      // Date (idempotent for a real Date from the live fetch).
      for (const v of providerVehicles) v.lastSeenAt = reviveDate(v.lastSeenAt);
    }
  } catch (e) {
    providerError = e instanceof Error ? e.message : 'GPS provider error';
    providerVehicles = null;
  }

  // Last-known positions for every active truck (fallback source).
  const lastKnown = await loadLastKnownPositions(activeTrips.map((t) => t.truckId));

  // Planned route legs for every active trip (used by both live and fallback).
  const legsByTrip = await fetchLegsWithRoutes(activeTrips.map((t) => t.tripId));

  const { vehicles, stale: initialStale, error: initialError, persist } = composeFleet({
    activeTrips,
    providerVehicles,
    providerError,
    lastKnown,
    legsByTrip,
    now,
  });
  let stale = initialStale;
  let error = initialError;

  // Fleet overview: also surface trucks NOT on an active trip, at their last-known
  // location — a live provider fix if one exists for the plate, else the persisted
  // or trail-derived last-known. Keeps the dispatch map populated even when no trip
  // is in-transit (the active-trip-only compose above would otherwise be empty).
  const coveredTruckIds = new Set(vehicles.map((v) => v.truckId));
  const allTrucks = await loadAllTrucks();
  const overviewIds = allTrucks.filter((t) => !coveredTruckIds.has(t.id)).map((t) => t.id);
  if (overviewIds.length > 0) {
    const [lastKnownAll, recentTrips] = await Promise.all([
      loadLastKnownAll(overviewIds),
      loadRecentTripsByTruck(overviewIds),
    ]);
    const fixByPlate = new Map<string, NormalizedGpsVehicle>();
    if (providerVehicles) for (const g of providerVehicles) fixByPlate.set(normalizePlate(g.numberPlate), g);
    for (const truck of allTrucks) {
      if (coveredTruckIds.has(truck.id)) continue;
      const ctx = recentTrips.get(truck.id) ?? null;
      const fix = fixByPlate.get(normalizePlate(truck.licensePlate));
      if (fix) {
        const fixStale = isStale(fix.lastSeenAt, now);
        const v: LiveFleetVehicle = {
          truckId: truck.id,
          licensePlate: truck.licensePlate,
          deviceId: fix.deviceId,
          lat: fix.lat,
          lng: fix.lng,
          speed: fix.speed,
          angle: fix.angle,
          address: fix.address,
          status: deriveStatus(fixStale, fix.lostSignal, fix.speed),
          ignitionOn: fix.ignitionOn,
          fuel: fix.fuel,
          gpsDriverName: fix.driverName,
          lastSeenAt: fix.lastSeenAt ? fix.lastSeenAt.toISOString() : '',
          stale: fixStale,
          tripId: ctx?.tripId ?? null,
          tripCode: ctx?.tripCode ?? null,
          driverName: ctx?.driverName ?? null,
          customerName: ctx?.customerName ?? null,
          routeName: ctx?.routeName ?? null,
          legs: [],
          details: fix.details ?? null,
        };
        vehicles.push(v);
        persist.push(toPositionRow(v));
      } else {
        const pos = lastKnownAll.get(truck.id);
        if (!pos || pos.lat == null || pos.lng == null) continue;
        vehicles.push({
          truckId: truck.id,
          licensePlate: truck.licensePlate,
          deviceId: pos.deviceId,
          lat: pos.lat,
          lng: pos.lng,
          speed: pos.speed ?? 0,
          angle: pos.angle ?? 0,
          address: pos.address,
          status: 'offline',
          ignitionOn: pos.ignitionOn,
          fuel: pos.fuel,
          gpsDriverName: pos.gpsDriverName,
          lastSeenAt: pos.lastSeenAt ? pos.lastSeenAt.toISOString() : '',
          stale: true,
          tripId: ctx?.tripId ?? null,
          tripCode: ctx?.tripCode ?? null,
          driverName: ctx?.driverName ?? null,
          customerName: ctx?.customerName ?? null,
          routeName: ctx?.routeName ?? null,
          legs: [],
          details: null,
        });
      }
    }
  }

  // Recompute aggregate flags now that overview vehicles may have been added.
  // A populated map suppresses the error banner — EXCEPT when an active trip is
  // still missing from the map (provider down + no last-known for it): parked-truck
  // pins must not hide that a driving truck is unreported.
  const shownTruckIds = new Set(vehicles.map((v) => v.truckId));
  const activeTripUncovered = activeTrips.some((t) => !shownTruckIds.has(t.truckId));
  if (vehicles.length > 0) {
    stale = vehicles.every((v) => v.stale);
    if (!activeTripUncovered) error = undefined;
  }

  // Persist fresh live fixes so the next provider outage can fall back to them.
  // Non-fatal: a DB hiccup must never break the live response.
  if (persist.length > 0) {
    await persistLastPositions(persist).catch((e) =>
      console.warn('vehicle_last_positions persist failed', e),
    );
  }

  return error ? { vehicles, stale: true, fetchedAt, error } : { vehicles, stale, fetchedAt };
}
