/**
 * Route capture — on trip completion, persist the truck's real Bách Khoa GPS
 * trail for the trip and derive real per-(origin,destination) routes from it.
 *
 * TWO PHASES (split so the slow OSM-geocoding derivation never blocks trail
 * persistence, and never gets abandoned by the completion hook's budget):
 *   Phase 1  captureTripGpsTrack()        — fetch + TRIP-SCOPE the trail,
 *                                            persist trip_gps_tracks (polyline
 *                                            + significant stops). No geocoding.
 *   Phase 2  deriveRoutesForStoredTrip()   — slice the STORED trail per leg,
 *                                            upsert route_polylines, backfill
 *                                            trip_legs.km for legs still at 0.
 *                                            Slow (Nominatim, ~1 req/s).
 *
 * The completion hook (routes/trips.ts) runs Phase 1, then fires Phase 2
 * fire-and-forget off the real persist promise. backfill/rederive scripts await
 * both. deriveRoutesForTrip is shared Phase-2 logic (also used by rederive).
 *
 * Trail scoping (PR1): the captured trail used to be the truck's whole
 * [dep-1day, compDay] movement — other trips' driving included — so a ~600 km
 * round trip could store a 1500+ km trail and the per-leg slicer matched 0/2.
 * The trail is now narrowed to the trip's actual [departure-1h, completion]
 * window before persistence (tripWindowBoundsMs + filterToWindow).
 *
 * Slicing (current impl) matches each leg to OSM-geocoded origin/destination
 * via a forward scan (round-trip safe). km is backfilled ONLY for legs missing
 * it (km=0) — never overwriting a hand-entered or previously-derived value.
 *
 * Never throws — called fire-and-forget.
 */
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import * as schema from '../../db/schema';
import { resolveCarId, getJourneyRange, getStopDetail } from './reports';
import { cleanPlaceName, sliceLegByPlaces, dedupPoints, encodePolyline, decodePolyline, trailDistanceKm, haversineKm, tripWindowBoundsMs, filterToWindow, type LngLat } from './route-capture';
import { geocodePlace } from '../map4d';

const MATCH_TOL_KM = 5;
const DETOUR_MAX = 2.2;

function isoDay(d: unknown): string {
  const s = d instanceof Date ? d.toISOString() : String(d ?? '');
  return s.slice(0, 10);
}
function addDay(day: string, delta: number): string {
  return new Date(new Date(day + 'T00:00:00Z').getTime() + delta * 86400000).toISOString().slice(0, 10);
}

/** A resolved significant stop — a real GPS waypoint from Bách Khoa. */
export interface GpsStopRecord {
  lat: number;
  lng: number;
  address: string | null;
  startTime: string | null;
  durationSec: number | null;
}

/**
 * The truck's ordered significant stops (Bách Khoa DetailStop report, ≥3min
 * each) — real GPS waypoints along the trip. Persisted to trip_gps_tracks.stops
 * so the map can render numbered markers at real stop coordinates (1..N).
 * Returns [] on any provider error. Callers trip-scope the result by startTime.
 */
async function fetchSignificantStops(
  carId: number,
  dateFrom: string,
  dateTo: string,
): Promise<GpsStopRecord[]> {
  try {
    const { stops } = await getStopDetail(carId, { dateFrom, dateTo });
    return stops
      .filter(s => s.lat != null && s.lng != null && (s.durationSec ?? 0) >= 180)
      .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''))
      .map(s => ({ lat: s.lat!, lng: s.lng!, address: s.address, startTime: s.startTime, durationSec: s.durationSec }));
  } catch {
    return [];
  }
}

/**
 * Slice a trail into per-leg routes and upsert them into route_polylines. Each
 * leg's origin/destination is resolved to coordinates via Map4D (the provider
 * the Bách Khoa portal embeds; Vietnam-scoped, Redis-cached ~3 months), then
 * matched to the trail's first forward pass within MATCH_TOL_KM. Also backfills
 * each matched leg's driven `km` (fixes legs saved with km=0). Shared Phase-2
 * logic for the completion hook and rederive script.
 */
export async function deriveRoutesForTrip(
  tripId: number,
  routeId: number | null,
  pts: LngLat[],
  legs: Array<{ id: number; origin: string; destination: string; km: number | null }>,
): Promise<{ legsDerived: number; legsTotal: number }> {
  let fromIdx = 0;
  let legsDerived = 0;
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    const o = cleanPlaceName(leg.origin), d = cleanPlaceName(leg.destination);
    if (!o || !d) continue;
    const [oCoord, dCoord] = await Promise.all([geocodePlace(leg.origin), geocodePlace(leg.destination)]);
    const slice = sliceLegByPlaces(pts, fromIdx, oCoord, dCoord, MATCH_TOL_KM);
    if (!slice) continue; // truck never passed near an endpoint → skip this leg
    fromIdx = slice.endIdx;
    const dp = dedupPoints(slice.points, 15);
    if (dp.length < 2) continue;
    const candKm = Math.round(trailDistanceKm(dp) * 100) / 100;
    const straightKm = haversineKm(dp[0], dp[dp.length - 1]);
    if (straightKm < 0.5 || candKm / straightKm > DETOUR_MAX) continue;
    const poly = encodePolyline(dp);
    await db.insert(schema.routePolylines).values({
      originCleaned: o, destinationCleaned: d, encodedPolyline: poly, pointCount: dp.length,
      distanceKm: candKm.toFixed(2), sourceTripId: tripId, routeId,
    }).onConflictDoUpdate({
      target: [schema.routePolylines.originCleaned, schema.routePolylines.destinationCleaned],
      set: { encodedPolyline: poly, pointCount: dp.length, distanceKm: candKm.toFixed(2), sourceTripId: tripId, routeId, derivedAt: new Date() },
    });
    // Backfill driven distance ONLY for legs missing it (km=0/null). Never
    // overwrite an existing km — that could shift completed-trip fuel/cost math.
    if (!leg.km) {
      await db.update(schema.tripLegs).set({ km: Math.round(candKm) }).where(eq(schema.tripLegs.id, leg.id));
    }
    legsDerived++;
  }
  return { legsDerived, legsTotal: legs.length };
}

export type CaptureStatus = 'ok' | 'partial' | 'empty' | 'failed';

export interface CaptureResult {
  tripId: number;
  status: CaptureStatus;
  pointCount: number;
  legsDerived: number;
  legsTotal: number;
  errorKind?: string;
}

/**
 * Phase 1 — fetch + trip-scope the truck's real GPS trail and persist it
 * (polyline + significant stops). Fast: no per-leg geocoding. Returns as soon
 * as the trail is stored so the completion hook can fire Phase 2 untimed.
 * status: 'ok' (trail stored), 'empty' (no trail/legs/canceled), 'failed'.
 * legsDerived is always 0 here — derivation is Phase 2.
 */
export async function captureTripGpsTrack(tripId: number): Promise<CaptureResult> {
  const fail = (errorKind: string, legsTotal = 0): CaptureResult => ({ tripId, status: 'failed', pointCount: 0, legsDerived: 0, legsTotal, errorKind });
  try {
    const [trip] = await db.select({
      routeId: schema.trips.routeId, status: schema.trips.status, truckId: schema.trips.truckId,
      departureDate: schema.trips.departureDate, completedAt: schema.trips.completedAt,
      plate: schema.trucks.licensePlate,
    }).from(schema.trips)
      .innerJoin(schema.trucks, eq(schema.trips.truckId, schema.trucks.id))
      .where(eq(schema.trips.id, tripId)).limit(1);
    if (!trip) return fail('not_found');
    if (trip.status === 'CANCELED') return { tripId, status: 'empty', pointCount: 0, legsDerived: 0, legsTotal: 0, errorKind: 'canceled' };

    const carId = await resolveCarId(trip.plate);
    if (!carId) { console.warn('[gps] capture: no carId for trip', tripId); return fail('no_car_id'); }

    const legs = await db.select({
      id: schema.tripLegs.id, origin: schema.tripLegs.origin, destination: schema.tripLegs.destination, km: schema.tripLegs.km,
    }).from(schema.tripLegs).where(eq(schema.tripLegs.tripId, tripId)).orderBy(schema.tripLegs.sequence);
    if (legs.length === 0) return { tripId, status: 'empty', pointCount: 0, legsDerived: 0, legsTotal: 0, errorKind: 'no_legs' };

    const dep = isoDay(trip.departureDate);
    const compDay = trip.completedAt ? isoDay(trip.completedAt) : dep;
    // Fetch the truck's movement across the surrounding days, then narrow to the
    // trip's own window — drops the prior day's other-trip driving + anything
    // after completion (the cause of 1500+ km trails for ~600 km trips).
    const journeyAll = await getJourneyRange(carId, addDay(dep, -1), compDay);
    const { lowerMs, upperMs } = tripWindowBoundsMs(dep, compDay, trip.completedAt);
    const journey = filterToWindow(
      journeyAll,
      p => (p.time ? Date.parse(p.time) : null),
      lowerMs, upperMs,
    );
    const pts: LngLat[] = [];
    for (const p of journey) if (p.lat != null && p.lng != null) pts.push([p.lat, p.lng]);
    if (pts.length < 2) return { tripId, status: 'empty', pointCount: pts.length, legsDerived: 0, legsTotal: legs.length, errorKind: 'no_points' };

    const fullPoly = encodePolyline(pts);
    const fullKm = Math.round(trailDistanceKm(pts) * 100) / 100;
    const firstPt = journey[0];
    const lastPt = journey[journey.length - 1];
    const startedAt = firstPt?.time ? new Date(firstPt.time) : null;
    const endedAt = lastPt?.time ? new Date(lastPt.time) : null;

    // Significant stops are fetched over the wider day window (the report is
    // day-scoped) but narrowed to the trip window so map markers belong to this
    // trip, not the truck's other trips that day.
    const sigStopsAll = await fetchSignificantStops(carId, addDay(dep, -1), compDay);
    const sigStops = filterToWindow(
      sigStopsAll,
      s => (s.startTime ? Date.parse(s.startTime) : null),
      lowerMs, upperMs,
    );

    // Persist trail + stops. status/segmentMatched are finalised by Phase 2
    // (deriveRoutesForStoredTrip); until then 'ok' = trail stored.
    await db.insert(schema.tripGpsTracks).values({
      tripId,
      routeId: trip.routeId,
      truckId: trip.truckId,
      carId,
      licensePlate: trip.plate,
      encodedPolyline: fullPoly,
      pointCount: pts.length,
      distanceKm: fullKm.toFixed(2),
      stops: sigStops.length ? sigStops : null,
      startedAt,
      endedAt,
      status: 'ok',
      segmentMatched: false,
    }).onConflictDoUpdate({
      target: schema.tripGpsTracks.tripId,
      set: {
        routeId: trip.routeId,
        truckId: trip.truckId,
        carId,
        licensePlate: trip.plate,
        encodedPolyline: fullPoly,
        pointCount: pts.length,
        distanceKm: fullKm.toFixed(2),
        stops: sigStops.length ? sigStops : null,
        startedAt,
        endedAt,
        status: 'ok',
        segmentMatched: false,
        capturedAt: new Date(),
      },
    });
    console.log('[gps] trail stored for trip', tripId, `(${pts.length} pts, ${fullKm} km) — derivation queued`);
    return { tripId, status: 'ok', pointCount: pts.length, legsDerived: 0, legsTotal: legs.length };
  } catch (e: unknown) {
    const msg = (e as Error)?.message ?? String(e);
    console.warn('[gps] captureTripGpsTrack failed', { tripId, err: msg });
    return fail(msg.slice(0, 30) || 'unknown');
  }
}

/**
 * Phase 2 — derive per-leg routes from the STORED trail (no portal re-hit):
 * slice each leg, upsert route_polylines, backfill trip_legs.km for legs still
 * at 0, and finalise the track's status/segmentMatched. Slow (OSM geocoding per
 * leg). Called untimed by the completion hook and directly by the rederive +
 * backfill scripts.
 */
export async function deriveRoutesForStoredTrip(tripId: number): Promise<{ legsDerived: number; legsTotal: number }> {
  const [track] = await db.select({
    poly: schema.tripGpsTracks.encodedPolyline, routeId: schema.tripGpsTracks.routeId,
  }).from(schema.tripGpsTracks).where(eq(schema.tripGpsTracks.tripId, tripId)).limit(1);
  const legs = await db.select({
    id: schema.tripLegs.id, origin: schema.tripLegs.origin, destination: schema.tripLegs.destination, km: schema.tripLegs.km,
  }).from(schema.tripLegs).where(eq(schema.tripLegs.tripId, tripId)).orderBy(schema.tripLegs.sequence);
  if (!track || legs.length === 0) return { legsDerived: 0, legsTotal: legs.length };
  const pts = decodePolyline(track.poly);
  if (pts.length < 2) return { legsDerived: 0, legsTotal: legs.length };
  const { legsDerived, legsTotal } = await deriveRoutesForTrip(tripId, track.routeId ?? null, pts, legs);
  // Reflect the derivation outcome on the track row: 'ok' (≥1 leg matched) or
  // 'partial' (trail stored but no leg matched).
  await db.update(schema.tripGpsTracks).set({
    status: legsDerived > 0 ? 'ok' : 'partial',
    segmentMatched: legsTotal > 0 && legsDerived === legsTotal,
  }).where(eq(schema.tripGpsTracks.tripId, tripId));
  console.log('[gps] derived routes for trip', tripId, `(${legsDerived}/${legsTotal} legs)`);
  return { legsDerived, legsTotal };
}
