/**
 * Re-run GPS route capture for a single trip (default: 53) to backfill any legs
 * whose real route was missed at completion. Populates route_polylines via the
 * same pipeline as the completion hook (Bách Khoa journey → sliceLegByPlaces).
 *
 * Run: cd backend && npx tsx scripts/recapture-trip.ts [tripId]
 */
import { eq } from 'drizzle-orm';
import { db } from '../src/db';
import * as schema from '../src/db/schema';
import { captureTripGpsTrack } from '../src/services/gps/capture.service';
import { fetchRouteMap } from '../src/services/gps/route-lookup';
import { resolveRoute } from '../src/services/gps/route-capture';

async function legPairStatus(tripId: number) {
  const legs = await db.select({
    origin: schema.tripLegs.origin, destination: schema.tripLegs.destination,
  }).from(schema.tripLegs).where(eq(schema.tripLegs.tripId, tripId)).orderBy(schema.tripLegs.sequence);
  const byPair = await fetchRouteMap(legs);
  return legs.map((l, i) => {
    const r = resolveRoute(byPair, l.origin, l.destination);
    return { leg: i + 1, origin: l.origin, dest: l.destination, hasRoute: !!r, km: r?.km ?? null };
  });
}

async function main() {
  const tripId = Number(process.argv[2]) || 53;
  console.log(`=== trip ${tripId} route pairs BEFORE ===`);
  const before = await legPairStatus(tripId);
  before.forEach((l) => console.log(`  leg ${l.leg}: ${l.origin} -> ${l.dest} | hasRoute=${l.hasRoute} km=${l.km}`));

  console.log(`\n=== running captureTripGpsTrack(${tripId}) ===`);
  await captureTripGpsTrack(tripId);

  console.log(`\n=== trip ${tripId} route pairs AFTER ===`);
  const after = await legPairStatus(tripId);
  after.forEach((l) => console.log(`  leg ${l.leg}: ${l.origin} -> ${l.dest} | hasRoute=${l.hasRoute} km=${l.km}`));

  const gained = after.filter((l, i) => l.hasRoute && !before[i].hasRoute).length;
  console.log(`\n=== legs gained a route: ${gained} | total with route: ${after.filter((l) => l.hasRoute).length}/${after.length} ===`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
