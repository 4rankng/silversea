/**
 * US-1: Clean route_polylines using Google GROUND-TRUTH geocoding.
 * Geocodes each unique place name, then validates every route's direction
 * against the true coords: keep / flip (reversed) / drop. Repopulates DB +
 * re-emits migration 0064. Run: cd backend && npx tsx scripts/clean-seed.ts
 */
import { sql } from 'drizzle-orm';
import { db } from '../src/db';
import * as schema from '../src/db/schema';
import { config } from '../src/config';
import { decodePolyline, reverseEncodedPolyline, haversineKm } from '../src/services/gps/route-capture';
import { writeFileSync, readFileSync } from 'fs';

const TOL_KM = 10;
const geoCache = new Map<string, [number, number] | null>();

async function geocode(place: string): Promise<[number, number] | null> {
  if (geoCache.has(place)) return geoCache.get(place)!;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(place)}&components=country:vn&language=vi&key=${config.googleMapsApiKey}`;
  try {
    const r = await fetch(url);
    const d = await r.json() as { results?: Array<{ geometry?: { location?: { lat: number; lng: number } } }> };
    const loc = d.results?.[0]?.geometry?.location;
    const res: [number, number] | null = loc ? [loc.lat, loc.lng] : null;
    geoCache.set(place, res);
    return res;
  } catch {
    geoCache.set(place, null);
    return null;
  }
}

interface Row { origin: string; destination: string; poly: string; km: number; }

async function main() {
  const rows: Row[] = (await db.select().from(schema.routePolylines)).map((r) => ({
    origin: r.originCleaned, destination: r.destinationCleaned, poly: r.encodedPolyline, km: Number(r.distanceKm),
  }));
  console.log(`loaded ${rows.length} routes`);

  const places = new Set<string>();
  rows.forEach((r) => { places.add(r.origin); places.add(r.destination); });
  console.log(`geocoding ${places.size} unique places…`);
  const coord: Record<string, [number, number] | null> = {};
  for (const p of places) coord[p] = await geocode(p);
  const failed = Object.values(coord).filter((c) => !c).length;
  console.log(`geocoded: ${places.size - failed} ok, ${failed} failed`);

  let kept = 0, flipped = 0, dropped = 0;
  const out: Row[] = [];
  for (const r of rows) {
    const pts = decodePolyline(r.poly);
    const start = pts[0], end = pts[pts.length - 1];
    const oC = coord[r.origin], dC = coord[r.destination];
    if (!oC || !dC) { out.push(r); kept++; continue; } // can't geocode → keep
    const sO = haversineKm(start, oC) <= TOL_KM, eD = haversineKm(end, dC) <= TOL_KM;
    const sD = haversineKm(start, dC) <= TOL_KM, eO = haversineKm(end, oC) <= TOL_KM;
    if (sO && eD) { out.push(r); kept++; }                          // correct direction
    else if (sD && eO) { out.push({ ...r, poly: reverseEncodedPolyline(r.poly) }); flipped++; } // reversed → flip
    else { dropped++; }                                              // confused/loop → drop
  }
  console.log(`kept=${kept} flipped=${flipped} dropped=${dropped} → ${out.length} validated`);

  await db.execute(sql`TRUNCATE TABLE "route_polylines"`);
  for (const r of out) {
    const n = decodePolyline(r.poly).length;
    await db.execute(sql`INSERT INTO "route_polylines" ("origin_cleaned","destination_cleaned","encoded_polyline","point_count","distance_km")
      VALUES (${r.origin}, ${r.destination}, ${r.poly}, ${n}, ${r.km.toString()})`);
  }

  const esc = (s: string) => s.replace(/'/g, "''");
  const vals = out.map((r) => `('${esc(r.origin)}','${esc(r.destination)}','${esc(r.poly)}',${decodePolyline(r.poly).length},${r.km.toString()},NULL,NULL)`).join(',\n  ');
  const seedSql = `-- Seed route_polylines from Bách Khoa GPS (direction-validated vs Google geocode, ${new Date().toISOString().slice(0, 10)}).
INSERT INTO "route_polylines" ("origin_cleaned","destination_cleaned","encoded_polyline","point_count","distance_km","source_trip_id","route_id")
VALUES
  ${vals}
ON CONFLICT ("origin_cleaned","destination_cleaned") DO UPDATE SET
  "encoded_polyline" = EXCLUDED."encoded_polyline", "point_count" = EXCLUDED."point_count",
  "distance_km" = EXCLUDED."distance_km", "source_trip_id" = EXCLUDED."source_trip_id",
  "route_id" = EXCLUDED."route_id", "derived_at" = now();
`;
  const raw = readFileSync('drizzle/0064_route_polylines.sql', 'utf8');
  const ddl = raw.slice(0, raw.indexOf(';', raw.indexOf('CREATE UNIQUE INDEX')) + 1);
  writeFileSync('drizzle/0064_route_polylines.sql', ddl + '\n\n--> statement-breakpoint\n' + seedSql);
  console.log(`re-emitted 0064 with ${out.length} validated routes`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
