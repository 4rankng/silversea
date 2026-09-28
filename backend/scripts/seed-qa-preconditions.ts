/**
 * QA preconditions: seed the data shape that local QA cases require but the
 * ordinary dev seed does not produce.
 *
 * WHY THIS EXISTS
 * ---------------
 * Four cases in testplan/qa/cases/dispatch-sweep-2026-09-09/ return BLOCKED on
 * a freshly seeded local DB, so a green topic was hiding four cases that never
 * actually asserted anything. They are not all the same kind of gap, and
 * conflating them is how this went unnoticed:
 *
 *   - QA0920-BL-RE / plated-not-issued fixtures  → STAGING-ONLY. No seeder in
 *     this repo creates them; they were hand-built on a staging env. Left for
 *     the staging topic. Documented in the case files themselves.
 *   - A route whose road_allowance covers exactly ONE trailer type  → DERIVABLE
 *     from the product model, so it should be reproducible locally. That is
 *     what this script creates, for TC-ROAD-ALLOWANCE-001.
 *
 * TC-ROAD-ALLOWANCE-001 (regression KP-159) needs: a route with a
 * road_allowance for 20FT but NOT for 40FT, so that switching a trip's
 * trailerType to the type with no rate must resolve to 0 rather than silently
 * falling back to the old type's rate. A route with allowances for BOTH types
 * cannot express that, which is why the case scans for exactly one.
 *
 * USAGE
 * -----
 *   npx tsx scripts/seed-qa-preconditions.ts
 *
 * Idempotent: re-running finds the same route by its `code` and leaves it
 * alone. The route is named QA-PRE-RA-ROADALLOWANCE so it is obvious in the UI
 * that it is test data, and it is the ONLY thing this script creates.
 *
 * It does NOT delete anything. Sweeping QA fixtures away is what made this
 * class of gap invisible in the first place.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../src/db';
import * as s from '../src/db/schema';

const ROUTE_CODE = 'QA-PRE-RA-ROADALLOWANCE';
const ROUTE_NAME = 'QA PRE RA — road allowance single-type';
const TRAILER_WITH_RATE = '20FT' as const;
const TRAILER_WITHOUT_RATE = '40FT' as const;
const BASE_AMOUNT = '1000000';

async function main(): Promise<void> {
  // 1. The route. Prefer one that already exists by code, so re-running is a
  //    no-op rather than a second near-identical route that muddies the scan.
  const [existingRoute] = await db
    .select({ id: s.routes.id, name: s.routes.name })
    .from(s.routes)
    .where(eq(s.routes.code, ROUTE_CODE))
    .limit(1);

  let routeId: number;
  if (existingRoute) {
    routeId = existingRoute.id;
    console.log(`[qa-pre] route #${routeId} already present (${existingRoute.name}) — reusing`);
  } else {
    const [created] = await db
      .insert(s.routes)
      .values({
        name: ROUTE_NAME,
        shortName: 'QA-PRE-RA',
        code: ROUTE_CODE,
        distanceKm: 100,
        isMountain: false,
      })
      .returning({ id: s.routes.id });
    routeId = created.id;
    console.log(`[qa-pre] created route #${routeId} (${ROUTE_NAME})`);
  }

  // 2. The allowance for the type that HAS a rate.
  const [existingAllowance] = await db
    .select({ id: s.roadAllowances.id })
    .from(s.roadAllowances)
    .where(and(eq(s.roadAllowances.routeId, routeId), eq(s.roadAllowances.trailerType, TRAILER_WITH_RATE)))
    .limit(1);

  if (existingAllowance) {
    console.log(`[qa-pre] ${TRAILER_WITH_RATE} allowance already present on route #${routeId}`);
  } else {
    const [created] = await db
      .insert(s.roadAllowances)
      .values({ routeId, trailerType: TRAILER_WITH_RATE, baseAmount: BASE_AMOUNT })
      .returning({ id: s.roadAllowances.id });
    console.log(`[qa-pre] created ${TRAILER_WITH_RATE} allowance #${created.id} on route #${routeId}`);
  }

  // 3. The case is only meaningful if the OTHER type has NO rate. If a previous
  //    run or a hand edit left one behind, the route is disqualified and the
  //    case would report BLOCKED with a confusing message — so remove it and
  //    say so loudly. This is a scoped delete of test data on a QA route only.
  const [stray] = await db
    .select({ id: s.roadAllowances.id })
    .from(s.roadAllowances)
    .where(and(eq(s.roadAllowances.routeId, routeId), eq(s.roadAllowances.trailerType, TRAILER_WITHOUT_RATE)))
    .limit(1);

  if (stray) {
    await db
      .update(s.roadAllowances)
      .set({ deletedAt: new Date() })
      .where(eq(s.roadAllowances.id, stray.id));
    console.log(
      `[qa-pre] soft-deleted a stray ${TRAILER_WITHOUT_RATE} allowance (#${stray.id}) — ` +
        'the case needs exactly one trailer type priced on this route',
    );
  }

  // 4. Verify what the case will actually scan, so a silent no-op is impossible.
  const live = await db
    .select({ trailerType: s.roadAllowances.trailerType })
    .from(s.roadAllowances)
    .where(and(eq(s.roadAllowances.routeId, routeId), isNull(s.roadAllowances.deletedAt)));

  const types = live.map((r) => r.trailerType).sort();
  const usable = types.length === 1;
  console.log(`[qa-pre] route #${routeId} priced trailer types: ${types.join(', ') || '(none)'}`);
  console.log(
    usable
      ? `[qa-pre] ✓ TC-ROAD-ALLOWANCE-001 can now find this route (one type priced, one not)`
      : `[qa-pre] ✗ route #${routeId} has ${types.length} priced types — the case needs exactly 1`,
  );
  if (!usable) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[qa-pre] failed:', err);
  process.exit(1);
});
