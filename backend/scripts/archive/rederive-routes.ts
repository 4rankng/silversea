/**
 * Re-derive per-leg routes from STORED GPS trails (no Bách Khoa re-hit): slice
 * each leg, upsert route_polylines, backfill trip_legs.km for legs still at 0.
 * Run after changing the matcher or after re-capturing trails with a new window.
 * Nominatim is throttled to 1 req/s, so this takes a few minutes (cached per
 * unique place name). Delegates to deriveRoutesForStoredTrip (shared Phase-2
 * logic, also used by the completion hook + backfill script).
 *
 * Run: cd backend && npx tsx scripts/rederive-routes.ts
 */
import { db } from '../src/db';
import * as schema from '../src/db/schema';
import { deriveRoutesForStoredTrip } from '../src/services/gps/capture.service';

async function main() {
  const tracks = await db.select({ tripId: schema.tripGpsTracks.tripId })
    .from(schema.tripGpsTracks).orderBy(schema.tripGpsTracks.tripId);

  console.log(`[rederive] ${tracks.length} stored trails`);
  let legsDerivedTotal = 0, legsTotalSum = 0, improved = 0;
  for (const t of tracks) {
    const { legsDerived, legsTotal } = await deriveRoutesForStoredTrip(t.tripId);
    legsDerivedTotal += legsDerived; legsTotalSum += legsTotal;
    if (legsDerived > 0) improved++;
    console.log(`[rederive] trip ${t.tripId}: ${legsDerived}/${legsTotal} legs`);
  }
  console.log(`[rederive] DONE ${legsDerivedTotal}/${legsTotalSum} legs across ${tracks.length} trips (${improved} with ≥1 route)`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('[rederive] fatal', e); process.exit(1); });
