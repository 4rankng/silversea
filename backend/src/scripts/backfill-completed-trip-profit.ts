/**
 * SIL-1137 — one-shot backfill for COMPLETED OWN legs whose P&L fields
 * (totalCost/grossProfit) are still NULL.
 *
 * Why the gaps exist: trip creation writes neither field, the pairing
 * transaction writes the cost/profit pair on the SECOND leg only, and a pair
 * MAIN leg closed without a dispatcher figures-save (driver-app close) held
 * the NULL forever — the completion materializer skipped its cost/profit
 * rewrite whenever the salary/toll delta was 0 (QA retest 4, staging trips
 * 591+592: 591 showed a fabricated "0 ₫ / 0,0%", 592 the correct
 * "3.800.000 ₫ / 100,0%"). The materializer now enforces the
 * never-a-null-gap law for the cost/profit pair at every completion; this
 * script replays that same idempotent materializer over the already-completed
 * rows so their surfaces read real numbers again. Stored values always win,
 * so legs carrying governed figures are a no-op by construction.
 *
 * Idempotent: re-running finds no candidates (the SQL gate reads NULL only).
 *
 * Usage:
 *   cd backend && npx tsx src/scripts/backfill-completed-trip-profit.ts [--dry-run]
 */
import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { materializeCompletedTripEconomics } from '../services/trip-completion-economics.service';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log(`\n=== Completed-trip P&L backfill (SIL-1137) ===`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}\n`);

  const candidates = await db.select({
    id: s.tripsComposite.id,
    tripCode: s.tripsComposite.tripCode,
    completedAt: s.tripsComposite.completedAt,
    totalCost: s.tripsComposite.totalCost,
    grossProfit: s.tripsComposite.grossProfit,
  }).from(s.tripsComposite)
    .where(and(
      eq(s.tripsComposite.status, 'COMPLETED'),
      eq(s.tripsComposite.carrierType, 'OWN'),
      isNull(s.tripsComposite.deletedAt),
      sql`${s.tripsComposite.completedAt} is not null`,
      sql`(${s.tripsComposite.totalCost} is null or ${s.tripsComposite.grossProfit} is null)`,
    ));

  console.log(`Found ${candidates.length} completed OWN trip(s) with a NULL cost/profit gap\n`);

  let materialized = 0;
  let unchanged = 0;
  let skipped = 0;
  let errors = 0;

  for (const trip of candidates) {
    if (trip.completedAt == null) {
      skipped++;
      continue;
    }
    if (DRY_RUN) {
      console.log(`[${trip.id}] ${trip.tripCode} would materialize (totalCost ${trip.totalCost ?? 'NULL'}, grossProfit ${trip.grossProfit ?? 'NULL'})`);
      materialized++;
      continue;
    }
    try {
      const result = await materializeCompletedTripEconomics(db, trip.id, trip.completedAt);
      if (result == null) {
        skipped++;
        continue;
      }
      if (result.changed) {
        materialized++;
        console.log(`[${trip.id}] ${trip.tripCode} materialized (salary ${result.salaryBefore} → ${result.salaryAfter}, toll ${result.tollBefore} → ${result.tollAfter})`);
      } else {
        unchanged++;
      }
    } catch (err) {
      errors++;
      console.error(`[${trip.id}] ${trip.tripCode} FAILED:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`\n=== Results ===`);
  console.log(`Materialized: ${materialized}`);
  console.log(`Unchanged:    ${unchanged}`);
  console.log(`Skipped:      ${skipped}`);
  console.log(`Errors:       ${errors}`);
  console.log(`Total:        ${candidates.length}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
