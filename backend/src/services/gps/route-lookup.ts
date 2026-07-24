/**
 * Fetch captured routes for a set of (origin,destination) legs — querying BOTH
 * directions so a captured A→B route also covers B→A (reversed). Returns a
 * `pair → route` map to pass to resolveRoute(). Shared by the trip-queries +
 * gps.service leg joins and the maps.service distance lookup.
 */
import { and, or, eq } from 'drizzle-orm';
import { db } from '../../db';
import * as schema from '../../db/schema';
import type { RouteEntry } from './route-capture';

export async function fetchRouteMap(
  legs: Array<{ origin: string; destination: string }>,
): Promise<Map<string, RouteEntry>> {
  const pairKeys = new Set<string>();
  for (const l of legs) {
    const o = (l.origin ?? '').trim().toLowerCase();
    const d = (l.destination ?? '').trim().toLowerCase();
    if (!o || !d) continue;
    pairKeys.add(`${o}|${d}`);
    pairKeys.add(`${d}|${o}`);
  }
  if (pairKeys.size === 0) return new Map();
  const rows = await db.select({
    originCleaned: schema.routePolylines.originCleaned,
    destinationCleaned: schema.routePolylines.destinationCleaned,
    polyline: schema.routePolylines.encodedPolyline,
    km: schema.routePolylines.distanceKm,
  }).from(schema.routePolylines).where(or(...[...pairKeys].map((p) => {
    const [o, d] = p.split('|');
    return and(eq(schema.routePolylines.originCleaned, o), eq(schema.routePolylines.destinationCleaned, d));
  })));
  return new Map(rows.map((r) => [`${r.originCleaned}|${r.destinationCleaned}`, { polyline: r.polyline, km: Number(r.km) }]));
}
