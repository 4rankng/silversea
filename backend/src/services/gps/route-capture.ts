/**
 * Route capture — turn a raw Bách Khoa GPS breadcrumb trail into reusable
 * per-(origin,destination) route polylines. Pure functions (no I/O), shared by
 * the backfill script and the runtime completion hook (gps/capture.service.ts).
 *
 * Pipeline: getJourney() trail → sliceLegByPlaces (match each leg's
 * origin/destination to geocoded coords) → dedupPoints → encodePolyline.
 * resolveRoute does the bidirectional lookup (A→B also covers B→A reversed)
 * used by the trip-queries + gps.service joins and the maps distance lookup.
 */
export type LngLat = [number, number];

/** Cleaned place-name key — MUST stay byte-identical to the `.trim().toLowerCase()`
 *  key the trip-queries/gps joins build from trip_legs. Single source of truth. */
export function cleanPlaceName(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

const R = 6371;
const toRad = (d: number) => (d * Math.PI) / 180;
export function haversineKm(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Sum of point-to-point distances — the driven km (slight chord underestimate). */
export function trailDistanceKm(points: LngLat[]): number {
  let km = 0;
  for (let i = 1; i < points.length; i++) km += haversineKm(points[i - 1], points[i]);
  return km;
}

/** Google encoded-polyline (precision 1e5). Inverse of frontend decodePolyline. */
export function encodePolyline(points: LngLat[], precision = 1e5): string {
  const encodeNum = (n: number): string => {
    let c = Math.round(n * precision);
    c = c < 0 ? ~(c << 1) : c << 1;
    let out = '';
    while (c >= 0x20) {
      out += String.fromCharCode((0x20 | (c & 0x1f)) + 63);
      c >>= 5;
    }
    return out + String.fromCharCode(c + 63);
  };
  let prevLat = 0;
  let prevLng = 0;
  let out = '';
  for (const [lat, lng] of points) {
    out += encodeNum(lat - prevLat) + encodeNum(lng - prevLng);
    prevLat = lat;
    prevLng = lng;
  }
  return out;
}

/** Decode a Google encoded polyline back to [lat,lng] points (inverse of encodePolyline). */
export function decodePolyline(encoded: string, precision = 1e5): LngLat[] {
  const pts: LngLat[] = [];
  let i = 0, lat = 0, lng = 0;
  while (i < encoded.length) {
    let shift = 0, result = 0, b: number;
    do { b = encoded.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    pts.push([lat / precision, lng / precision]);
  }
  return pts;
}

/** The same road reversed: decode → reverse point order → re-encode. */
export function reverseEncodedPolyline(encoded: string): string {
  return encodePolyline(decodePolyline(encoded).reverse());
}

export interface RouteEntry { polyline: string; km: number; }

/**
 * Resolve a leg's route BIDIRECTIONALLY against a `pair → route` map.
 * A road is the same in both directions, so if (origin,destination) has no
 * captured route, we reuse (destination,origin) reversed. An exact (o,d) match
 * always wins — so when a real return-direction capture arrives later, it takes
 * precedence over the reversed one.
 */
export function resolveRoute(
  byPair: Map<string, RouteEntry>,
  origin: string | null | undefined,
  destination: string | null | undefined,
): RouteEntry | null {
  const o = (origin ?? '').trim().toLowerCase();
  const d = (destination ?? '').trim().toLowerCase();
  const direct = byPair.get(`${o}|${d}`);
  if (direct) return direct;
  const reversed = byPair.get(`${d}|${o}`);
  return reversed ? { polyline: reverseEncodedPolyline(reversed.polyline), km: reversed.km } : null;
}

/** Spatial dedup: drop points within `radiusM` of the last kept point (reduces density). */
export function dedupPoints(pts: LngLat[], radiusM = 15): LngLat[] {
  if (pts.length < 2) return pts;
  const out: LngLat[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (haversineKm(out[out.length - 1], pts[i]) * 1000 > radiusM) out.push(pts[i]);
  }
  return out;
}

// ─── Trip-scoped trail window ────────────────────────────────────────────────
// The Bách Khoa portal reports in UTC+7 (parsePortalDateTime shifts to UTC), so
// a VN calendar date maps to midnight UTC+7. capture.service narrows the truck's
// day-paginated trail to the trip's own [departure-1h, completion] window before
// persisting — otherwise a ~600 km round trip stores the truck's full multi-day
// movement (other trips included) and the per-leg slicer matches 0/2.

/** Vietnam timezone offset used by the Bách Khoa portal. */
export const VN_OFFSET = '+07:00';

/**
 * Trip-scoped trail window, in epoch ms. Lower bound = departure-day VN-midnight
 * minus 1h (absorbs clock skew at the day boundary without re-ingesting the prior
 * day's other-trip driving). Upper bound = completion instant, or the end of the
 * completion VN-day when completedAt is null.
 */
export function tripWindowBoundsMs(
  dep: string,           // 'YYYY-MM-DD' (VN calendar day the trip departed)
  compDay: string,       // 'YYYY-MM-DD' (completion day; == dep when no completedAt)
  completedAt: Date | null,
): { lowerMs: number; upperMs: number } {
  const lowerMs = Date.parse(`${dep}T00:00:00${VN_OFFSET}`) - 3_600_000;
  const upperMs = completedAt
    ? new Date(completedAt).getTime()
    : Date.parse(`${compDay}T23:59:59${VN_OFFSET}`);
  return { lowerMs, upperMs };
}

/** Keep only entries whose timestamp falls in [lowerMs, upperMs]. Entries with no
 *  timestamp are kept (rare; can't be bounded). Degenerate bounds (upper ≤ lower)
 *  keep everything — safer than dropping the whole set. Pure + exported so it is
 *  unit-testable without the portal/DB. */
export function filterToWindow<T>(items: T[], timeMs: (t: T) => number | null, lowerMs: number, upperMs: number): T[] {
  if (!(upperMs > lowerMs)) return items;
  return items.filter((t) => {
    const ms = timeMs(t);
    if (ms == null) return true;
    return ms >= lowerMs && ms <= upperMs;
  });
}

/**
 * Slice a leg's actual driven portion by matching the truck's FIRST pass to the
 * ORIGIN and DESTINATION coordinates (ground-truth geocoded), scanning FORWARD
 * from `fromIdx`. Forward-order matching is essential for round trips: a global
 * nearest-to-origin would match a LATER revisit (the return leg), leaving no
 * trail after it for the destination. Returns null when the truck never passed
 * within tolKm of either endpoint. `endIdx` lets the next leg continue from here.
 */
export function sliceLegByPlaces(
  pts: LngLat[],
  fromIdx: number,
  originCoord: LngLat | null,
  destCoord: LngLat | null,
  tolKm = 5,
): { points: LngLat[]; endIdx: number } | null {
  if (!originCoord || !destCoord || pts.length < 2) return null;
  // First trail point within tolKm of the origin (forward scan respects trip order).
  let s = -1;
  for (let i = fromIdx; i < pts.length; i++) {
    if (haversineKm(pts[i], originCoord) <= tolKm) { s = i; break; }
  }
  if (s < 0) return null;
  // First trail point within tolKm of the destination, at/after the origin pass.
  let e = -1;
  for (let i = s; i < pts.length; i++) {
    if (haversineKm(pts[i], destCoord) <= tolKm) { e = i; break; }
  }
  if (e < 0 || e <= s) return null;
  return { points: pts.slice(s, e + 1), endIdx: e };
}
