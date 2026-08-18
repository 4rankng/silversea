/**
 * Backfill GPS trails + stops for trips, then derive per-leg routes. Hits Bách
 * Khoa per trip (getJourneyRange + getStopDetail), so it's sequential + slow;
 * run in the background.
 *
 * Modes:
 *   (default)            trailless COMPLETED/LOCKED trips (no trip_gps_tracks row)
 *   --refresh            re-capture trips that ALREADY have a trail — overwrites
 *                        the old over-scoped trail with the trip-scoped window
 *                        (PR1 fix for trips captured before the window narrowing)
 *   --trip <id>          just that one trip (works whether or not it has a trail)
 *   --limit N            cap the batch (safe to run in chunks)
 *
 * Phase 1 (captureTripGpsTrack) persists the trip-scoped trail + stops;
 * Phase 2 (deriveRoutesForStoredTrip) slices per leg + backfills trip_legs.km.
 *
 * Run: cd backend && npx tsx scripts/backfill-gps-trails.ts [--refresh] [--trip 56] [--limit N]
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../src/db';
import * as schema from '../src/db/schema';
import { captureTripGpsTrack, deriveRoutesForStoredTrip } from '../src/services/gps/capture.service';

async function main() {
  const argv = process.argv.slice(2);
  const refresh = argv.includes('--refresh');
  const tripIdx = argv.indexOf('--trip');
  const tripArg = tripIdx >= 0 ? Number(argv[tripIdx + 1]) : NaN;
  const limitIdx = argv.indexOf('--limit');
  const LIMIT = (() => {
    if (limitIdx !== -1 && argv[limitIdx + 1]) {
      const n = Number(argv[limitIdx + 1]);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    }
    return null;
  })();
  // `--limit 0` / `--limit abc` / a missing value must NOT silently fall through to
  // an unbounded run (every trailless trip then hits the slow Bách Khoa API). Abort.
  if (limitIdx !== -1 && LIMIT === null) {
    console.error(`--limit requires a positive integer (got "${argv[limitIdx + 1] ?? ''}"); aborting.`);
    process.exit(2);
  }

  let rows: { id: number }[];
  if (Number.isFinite(tripArg)) {
    rows = [{ id: tripArg }];
  } else if (refresh) {
    // Re-capture trips that already have a trail (idempotent upsert overwrites).
    const q = db.select({ id: schema.trips.id }).from(schema.trips)
      .innerJoin(schema.tripGpsTracks, eq(schema.tripGpsTracks.tripId, schema.trips.id))
      .where(and(isNull(schema.trips.deletedAt), inArray(schema.trips.status, ['COMPLETED', 'LOCKED'])))
      .orderBy(schema.trips.id);
    rows = LIMIT ? await q.limit(LIMIT) : await q;
  } else {
    const q = db.select({ id: schema.trips.id }).from(schema.trips)
      .leftJoin(schema.tripGpsTracks, eq(schema.tripGpsTracks.tripId, schema.trips.id))
      .where(and(
        isNull(schema.trips.deletedAt),
        inArray(schema.trips.status, ['COMPLETED', 'LOCKED']),
        isNull(schema.tripGpsTracks.tripId),
      ))
      .orderBy(schema.trips.id);
    rows = LIMIT ? await q.limit(LIMIT) : await q;
  }

  const mode = Number.isFinite(tripArg) ? `trip ${tripArg}` : refresh ? 'refresh-existing' : 'trailless';
  console.log(`[backfill] ${mode}: ${rows.length} trip(s) to capture${LIMIT ? ` (--limit ${LIMIT})` : ''}`);
  let ok = 0, empty = 0, failed = 0, withRoutes = 0;
  const failures: Array<{ id: number; kind?: string }> = [];
  for (const t of rows) {
    const c = await captureTripGpsTrack(t.id);            // Phase 1: persist trail
    let derived = '';
    if (c.status === 'ok') {
      const d = await deriveRoutesForStoredTrip(t.id);    // Phase 2: derive routes
      derived = `, derived ${d.legsDerived}/${d.legsTotal}`;
      if (d.legsDerived > 0) withRoutes++;
    }
    const tag = c.errorKind ? `, ${c.errorKind}` : '';
    console.log(`[backfill] trip ${t.id}: ${c.status} (pts=${c.pointCount}${derived}${tag})`);
    if (c.status === 'ok') ok++;
    else if (c.status === 'empty') empty++;
    else { failed++; failures.push({ id: t.id, kind: c.errorKind }); }
  }
  console.log(`[backfill] DONE trailStored ok=${ok} empty=${empty} failed=${failed} / ${rows.length}; tripsWithRoutes=${withRoutes}`);
  if (failures.length) console.log('[backfill] failures:', JSON.stringify(failures));
}

main().then(() => process.exit(0)).catch((e) => { console.error('[backfill] fatal', e); process.exit(1); });
