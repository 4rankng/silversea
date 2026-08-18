/**
 * Backfill generator — populate route_polylines from real Bách Khoa GPS tracks.
 *
 * 1. ensure route_polylines exists locally (idempotent DDL)
 * 2. for each GPS-enabled completed trip: getJourney (day-paginated) → compressTrail
 *    → sliceByLongStops → per-leg polylines
 * 3. pick the BEST polyline per (origin,destination) pair (most points; tiebreak latest)
 * 4. TRUNCATE+INSERT into route_polylines
 * 5. emit a seed SQL file (INSERT ... ON CONFLICT DO UPDATE) to bake into migration 0064
 *
 * Run: cd backend && npx tsx scripts/backfill-routes.ts
 */
import { sql } from 'drizzle-orm';
import { eq, and, inArray, isNull, isNotNull, desc } from 'drizzle-orm';
import { db } from '../src/db';
import * as schema from '../src/db/schema';
import { portalProvider } from '../src/services/gps/providers/portalProvider';
import { normalizePlate } from '../src/services/gps/parse';
import {
  cleanPlaceName, encodePolyline, sliceLegByPlaces, dedupPoints, trailDistanceKm, haversineKm,
  type LngLat,
} from '../src/services/gps/route-capture';
import { geocodePlace } from '../src/services/gps/place-geocode';

const MATCH_TOL_KM = 5; // a leg endpoint must be within this of its geocoded place
const DETOUR_MAX = 2.2; // reject slices whose driven km exceeds this × the straight-line distance

function isoDay(d: unknown): string {
  const s = d instanceof Date ? d.toISOString() : String(d ?? '');
  return s.slice(0, 10);
}
function addDay(day: string, delta: number): string {
  return new Date(new Date(day + 'T00:00:00Z').getTime() + delta * 86400000).toISOString().slice(0, 10);
}

interface Cand { origin: string; destination: string; poly: string; pts: number; km: number; tripId: number; routeId: number | null; }

async function main() {
  // 1. ensure table (idempotent) — mirrors migration 0064 DDL
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "route_polylines" (
      "id" serial PRIMARY KEY NOT NULL,
      "origin_cleaned" varchar(255) NOT NULL,
      "destination_cleaned" varchar(255) NOT NULL,
      "encoded_polyline" text NOT NULL,
      "point_count" integer NOT NULL,
      "distance_km" numeric(10, 2) NOT NULL,
      "source_trip_id" integer,
      "route_id" integer,
      "derived_at" timestamptz DEFAULT now() NOT NULL,
      "created_at" timestamptz DEFAULT now() NOT NULL
    )`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "route_polylines_uniq_idx" ON "route_polylines" ("origin_cleaned","destination_cleaned")`);
  console.log(' ensured route_polylines table');

  // 2. vehicles + trips
  const vehicles = await portalProvider.fetchVehicles();
  const carByPlate = new Map<string, number>();
  for (const v of vehicles) carByPlate.set(normalizePlate(v.numberPlate), v.carId ?? -1);
  const trips = (await db.select({
    tripId: schema.trips.id, routeId: schema.trips.routeId, status: schema.trips.status,
    departureDate: schema.trips.departureDate, completedAt: schema.trips.completedAt,
    plate: schema.trucks.licensePlate,
  }).from(schema.trips).innerJoin(schema.trucks, eq(schema.trips.truckId, schema.trucks.id))
    .where(and(inArray(schema.trips.status, ['COMPLETED', 'LOCKED']), isNull(schema.trips.deletedAt), isNotNull(schema.trucks.licensePlate)))
    .orderBy(desc(schema.trips.completedAt)))
    .map((r) => ({ ...r, carId: carByPlate.get(normalizePlate(r.plate ?? '')) ?? -1 }))
    .filter((r) => r.carId > 0);
  console.log(` ${trips.length} GPS-enabled trips to process\n`);

  // 3. per-trip → per-leg candidates
  const byKey = new Map<string, Cand>();
  let processed = 0, emptyJourney = 0, sliceOk = 0, segMiss = 0, failed = 0, legsDerived = 0, detourGated = 0;

  for (const t of trips) {
    processed++;
    try {
      const legs = await db.select({
        origin: schema.tripLegs.origin, destination: schema.tripLegs.destination, km: schema.tripLegs.km,
      }).from(schema.tripLegs).where(eq(schema.tripLegs.tripId, t.tripId)).orderBy(schema.tripLegs.sequence);

      const dep = isoDay(t.departureDate);
      const compDay = t.completedAt ? isoDay(t.completedAt) : dep;
      const journey = await getJourneyPaged(t.carId, addDay(dep, -1), compDay);
      if (journey.length < 2) { emptyJourney++; continue; }

      // Time-ordered [lat,lng] trail.
      const pts: LngLat[] = [];
      for (const p of journey) if (p.lat != null && p.lng != null) pts.push([p.lat, p.lng]);
      if (pts.length < 2) { emptyJourney++; continue; }
      sliceOk++;

      // Slice each leg by matching the truck's nearest pass to its geocoded
      // origin/destination coords (Google ground truth) — endpoints match the
      // places by construction, so direction can't be confused.
      let fromIdx = 0;
      for (const leg of legs) {
        const o = cleanPlaceName(leg.origin);
        const d = cleanPlaceName(leg.destination);
        if (!o || !d) continue;
        const slice = sliceLegByPlaces(pts, fromIdx, await geocodePlace(leg.origin), await geocodePlace(leg.destination), MATCH_TOL_KM);
        if (!slice) { segMiss++; continue; }   // truck never passed near an endpoint → skip this leg
        fromIdx = slice.endIdx;
        const dp = dedupPoints(slice.points, 15);
        if (dp.length < 2) continue;
        const candKm = Math.round(trailDistanceKm(dp) * 100) / 100;
        const straightKm = haversineKm(dp[0], dp[dp.length - 1]);
        if (straightKm < 0.5 || candKm / straightKm > DETOUR_MAX) { detourGated++; continue; }
        legsDerived++;
        const key = `${o}|${d}`;
        const cand: Cand = { origin: o, destination: d, poly: encodePolyline(dp), pts: dp.length, km: candKm, tripId: t.tripId, routeId: t.routeId };
        const prev = byKey.get(key);
        if (!prev || cand.pts > prev.pts) byKey.set(key, cand);   // best = most points (richest coverage)
      }
      if (processed % 10 === 0) console.log(`  …${processed}/${trips.length} trips, ${byKey.size} pairs so far`);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      failed++; console.log(`  trip #${t.tripId} failed: ${message}`);
    }
  }

  // 4. write to DB (clean slate)
  const cands = [...byKey.values()];
  await db.execute(sql`TRUNCATE TABLE "route_polylines"`);
  for (const c of cands) {
    await db.execute(sql`INSERT INTO "route_polylines"
      ("origin_cleaned","destination_cleaned","encoded_polyline","point_count","distance_km","source_trip_id","route_id")
      VALUES (${c.origin}, ${c.destination}, ${c.poly}, ${c.pts}, ${c.km.toString()}, ${c.tripId}, ${c.routeId})`);
  }

  // 5. emit seed SQL
  const esc = (s: string) => s.replace(/'/g, "''");
  const vals = cands.map((c) =>
    `('${esc(c.origin)}','${esc(c.destination)}','${esc(c.poly)}',${c.pts},${c.km.toString()},${c.tripId},${c.routeId ?? 'NULL'})`,
  ).join(',\n  ');
  const seedSql = `-- Seed route_polylines from Bách Khoa GPS (generated ${new Date().toISOString().slice(0, 10)}).
-- Idempotent: ON CONFLICT (origin_cleaned,destination_cleaned) DO UPDATE.
INSERT INTO "route_polylines"
  ("origin_cleaned","destination_cleaned","encoded_polyline","point_count","distance_km","source_trip_id","route_id")
VALUES
  ${vals}
ON CONFLICT ("origin_cleaned","destination_cleaned") DO UPDATE SET
  "encoded_polyline" = EXCLUDED."encoded_polyline",
  "point_count" = EXCLUDED."point_count",
  "distance_km" = EXCLUDED."distance_km",
  "source_trip_id" = EXCLUDED."source_trip_id",
  "route_id" = EXCLUDED."route_id",
  "derived_at" = now();
`;
  const { writeFileSync } = await import('fs');
  writeFileSync('drizzle/0064_route_polylines.seed.sql', seedSql);

  console.log(`\n=== DONE ===`);
  console.log(`trips: ${processed} | empty-journey: ${emptyJourney} | trips-with-trail: ${sliceOk} | failed: ${failed} | legs-not-found: ${segMiss}`);
  console.log(`legs derived: ${legsDerived} | rejected(detour>${DETOUR_MAX}×): ${detourGated} | unique pairs populated: ${cands.length}`);
  console.log(`seed SQL → drizzle/0064_route_polylines.seed.sql (${cands.length} rows, ~${Math.round(seedSql.length / 1024)} KB)`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
