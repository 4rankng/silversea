/** TEMP: what does Bách Khoa report for trip 56's truck/window? DetailStop +
 *  GetTrip segments — to find a reliable way to locate the Yên Sơn endpoint. */
import { eq } from 'drizzle-orm';
import { db } from '../src/db';
import * as schema from '../src/db/schema';
import { resolveCarId, getStopDetail, getTripSegments } from '../src/services/gps/reports';

function isoDay(d: unknown): string { const s = d instanceof Date ? d.toISOString() : String(d ?? ''); return s.slice(0, 10); }
function addDay(day: string, delta: number): string { return new Date(new Date(day + 'T00:00:00Z').getTime() + delta * 86400000).toISOString().slice(0, 10); }

async function main() {
  const [trip] = await db.select({ plate: schema.trucks.licensePlate, dep: schema.trips.departureDate, comp: schema.trips.completedAt })
    .from(schema.trips).innerJoin(schema.trucks, eq(schema.trucks.id, schema.trips.truckId)).where(eq(schema.trips.id, 56)).limit(1);
  const carId = await resolveCarId(trip.plate);
  const dep = isoDay(trip.dep), compDay = trip.comp ? isoDay(trip.comp) : dep;
  const range = { dateFrom: addDay(dep, -1), dateTo: compDay };
  console.log(`plate=${trip.plate} carId=${carId} range=${range.dateFrom}..${range.dateTo}`);

  console.log('\n=== DetailStop (all stops w/ coords, any duration) ===');
  try {
    const { stops, totals } = await getStopDetail(carId, range);
    console.log(`totals:`, totals, ` raw stops: ${stops.length}`);
    for (const s of stops.slice(0, 25)) {
      console.log(`  ${(s.startTime ?? '').slice(0,19)} dur=${s.durationSec}s lat=${s.lat} lng=${s.lng} addr=${(s.address ?? '').slice(0,50)}`);
    }
  } catch (e) { console.log('DetailStop ERROR:', (e as Error).message); }

  console.log('\n=== GetTrip segments (from/to/distance) ===');
  try {
    const segs = await getTripSegments(carId, range);
    console.log(`segments: ${segs.length}`);
    for (const s of segs.slice(0, 25)) {
      console.log(`  ${(s.startTime ?? '').slice(0,19)}->${(s.endTime ?? '').slice(0,19)} ${s.distanceKm}km  [${(s.fromAddress ?? '').slice(0,35)}] -> [${(s.toAddress ?? '').slice(0,35)}]`);
    }
  } catch (e) { console.log('GetTrip ERROR:', (e as Error).message); }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
