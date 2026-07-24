/**
 * Verify populated route_polylines: decode each, confirm endpoints match the
 * (origin,destination) cities and all points are in Vietnam. Read-only.
 * Run: cd backend && npx tsx scripts/verify-routes.ts
 */
import { db } from '../src/db';
import * as schema from '../src/db/schema';

function decodePolyline(encoded: string): [number, number][] {
  const pts: [number, number][] = [];
  let i = 0, lat = 0, lng = 0;
  while (i < encoded.length) {
    let shift = 0, result = 0, b: number;
    do { b = encoded.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : result >> 1;
    pts.push([lat / 1e5, lng / 1e5]);
  }
  return pts;
}

async function main() {
  const rows = await db.select().from(schema.routePolylines);
  console.log(`${rows.length} routes. Verifying endpoints + bounds...\n`);
  let oob = 0;
  for (const r of rows.slice(0, 12)) {
    const pts = decodePolyline(r.encodedPolyline);
    const lats = pts.map((p) => p[0]), lngs = pts.map((p) => p[1]);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const inVN = minLat >= 8 && maxLat <= 24 && minLng >= 102 && maxLng <= 110;
    if (!inVN) oob++;
    const f = pts[0], l = pts[pts.length - 1];
    console.log(`${r.originCleaned.slice(0, 22).padEnd(22)} → ${r.destinationCleaned.slice(0, 22).padEnd(22)}`);
    console.log(`   pts=${pts.length} km=${r.distanceKm}  start(${f[0].toFixed(3)},${f[1].toFixed(3)}) end(${l[0].toFixed(3)},${l[1].toFixed(3)})  ${inVN ? '✓ in-VN' : '✗ OUT-OF-BOUNDS'}`);
  }
  // bounds check across ALL rows
  let allOk = 0;
  for (const r of rows) {
    const pts = decodePolyline(r.encodedPolyline);
    const lats = pts.map((p) => p[0]), lngs = pts.map((p) => p[1]);
    if (Math.min(...lats) >= 8 && Math.max(...lats) <= 24 && Math.min(...lngs) >= 102 && Math.max(...lngs) <= 110) allOk++;
    else oob++;
  }
  console.log(`\nAll ${rows.length} routes: ${allOk} fully in-VN bounds, ${oob} out-of-bounds.`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
