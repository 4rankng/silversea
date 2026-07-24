/**
 * A1.5 / GAP 8a — Revenue split reconciliation audit (feedback202606).
 *
 * Companion to the A1 revenue-loss fix. Revenue is split-based in the UI
 * (`revenueEmptyReturn` + `revenueCombine`); the stored `revenue` column is the
 * derived total. The pre-A1 bug could drift `revenue` away from its splits on
 * save. This script reports every trip where the stored total no longer equals
 * the sum of its splits, and classifies each divergence:
 *
 *   • LEGIT OVERRIDE  — divergence + `revenue_overridden_by IS NOT NULL`
 *                       (a human explicitly set revenue; expected).
 *   • SUSPECT         — divergence + `revenue_overridden_by IS NULL`
 *                       (no explicit override logged; possibly bug-corrupted
 *                       or legacy direct-revenue data — needs human review).
 *
 * This script is strictly READ-ONLY. It never writes to the database and
 * performs no auto-fix. `--dry-run` is accepted for interface symmetry with
 * the other scripts but is a no-op: there is no write mode. A separate,
 * signed-off data-fix must repair any material SUSPECT count.
 *
 * Usage:
 *   npx tsx scripts/audit-revenue-splits.ts            # audit (default)
 *   npx tsx scripts/audit-revenue-splits.ts --dry-run  # same (explicit)
 *   npx tsx scripts/audit-revenue-splits.ts --sample 50  # show up to 50 suspects
 *
 * Exit code: 0 if no SUSPECT divergences; 1 if any SUSPECT divergences exist
 * (signals "human review required"). LEGIT overrides never trigger non-zero.
 *
 * Plan ref: feedback202606 finalization plan §2 (A1.5).
 */
import { db } from '../src/db';
import * as s from '../src/db/schema';
import { sql } from 'drizzle-orm';

const SAMPLE_LIMIT = (() => {
  const i = process.argv.indexOf('--sample');
  if (i !== -1 && process.argv[i + 1]) {
    const n = Number(process.argv[i + 1]);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 20;
  }
  return 20;
})();

interface DivergenceRow {
  id: number;
  tripCode: string | null;
  status: string;
  departureDate: string | null;
  revenue: string | null;
  revenueEmptyReturn: string | null;
  revenueCombine: string | null;
  sumSplits: string;
  diff: string;
  overriddenBy: number | null;
  overriddenAt: string | null;
}

async function main() {
  console.log('🔍 Revenue Split Reconciliation Audit');
  console.log(`   Mode: dry-run (read-only — this script never writes)`);
  console.log(`   Time: ${new Date().toISOString()}\n`);

  // One round-trip: every trip whose stored total != sum of its splits.
  // coalesce guards NULLs (revenue may be NULL; splits default '0' but defend).
  const rows = await db.select({
    id: s.trips.id,
    tripCode: s.trips.tripCode,
    status: s.trips.status,
    departureDate: s.trips.departureDate,
    revenue: s.trips.revenue,
    revenueEmptyReturn: s.trips.revenueEmptyReturn,
    revenueCombine: s.trips.revenueCombine,
    sumSplits: sql<string>`coalesce(${s.trips.revenueEmptyReturn}::numeric, 0) + coalesce(${s.trips.revenueCombine}::numeric, 0)`,
    diff: sql<string>`coalesce(${s.trips.revenue}::numeric, 0) - (coalesce(${s.trips.revenueEmptyReturn}::numeric, 0) + coalesce(${s.trips.revenueCombine}::numeric, 0))`,
    overriddenBy: s.trips.revenueOverriddenBy,
    overriddenAt: s.trips.revenueOverriddenAt,
  })
    .from(s.trips)
    .where(sql`abs(coalesce(${s.trips.revenue}::numeric, 0) - (coalesce(${s.trips.revenueEmptyReturn}::numeric, 0) + coalesce(${s.trips.revenueCombine}::numeric, 0))) > 0`)
    .orderBy(s.trips.id);

  const totalTrips = await db.select({ n: sql<string>`count(*)::int` }).from(s.trips);

  const divergent: DivergenceRow[] = rows.map(r => ({ ...r, sumSplits: String(r.sumSplits), diff: String(r.diff) }));
  const legit = divergent.filter(r => r.overriddenBy !== null);
  const suspect = divergent.filter(r => r.overriddenBy === null);

  console.log(`   Total trips scanned:        ${Number(totalTrips[0]?.n ?? 0)}`);
  console.log(`   Divergent (total != splits): ${divergent.length}`);
  console.log(`     • LEGIT override:          ${legit.length}  (revenue_overridden_by IS NOT NULL)`);
  console.log(`     • SUSPECT (no override):   ${suspect.length}  (revenue_overridden_by IS NULL — review)\n`);

  if (suspect.length > 0) {
    console.log(`${'─'.repeat(60)}`);
    console.log(`SUSPECT divergences (showing up to ${SAMPLE_LIMIT}):`);
    console.log(`${'─'.repeat(60)}`);
    for (const r of suspect.slice(0, SAMPLE_LIMIT)) {
      const rev = Number(r.revenue ?? 0);
      const splits = Number(r.sumSplits);
      console.log(
        `  ❓ Trip #${r.id} (${r.tripCode ?? '-'}) [${r.status}] ${r.departureDate ?? '-'}\n` +
        `      stored revenue=${rev}  splits(empty+combine)=${splits}  diff=${Number(r.diff)}\n` +
        `      emptyReturn=${Number(r.revenueEmptyReturn ?? 0)}  combine=${Number(r.revenueCombine ?? 0)}`,
      );
    }
    if (suspect.length > SAMPLE_LIMIT) {
      console.log(`  …and ${suspect.length - SAMPLE_LIMIT} more (raise with --sample N).`);
    }
  }

  if (legit.length > 0) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`LEGIT overrides (explicit human set — informational, up to ${SAMPLE_LIMIT}):`);
    console.log(`${'─'.repeat(60)}`);
    for (const r of legit.slice(0, SAMPLE_LIMIT)) {
      console.log(
        `  ✅ Trip #${r.id} (${r.tripCode ?? '-'}): revenue=${Number(r.revenue ?? 0)} splits=${Number(r.sumSplits)} diff=${Number(r.diff)} (by user #${r.overriddenBy} at ${r.overriddenAt ?? '-'})`,
      );
    }
    if (legit.length > SAMPLE_LIMIT) {
      console.log(`  …and ${legit.length - SAMPLE_LIMIT} more.`);
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log('📋 Decision required (no auto-fix performed):');
  console.log('═'.repeat(60));
  if (suspect.length === 0) {
    console.log('  ✅ No unexplained divergences. Nothing to repair.');
  } else {
    const totalDrift = suspect.reduce((acc, r) => acc + Math.abs(Number(r.diff)), 0);
    console.log(`  ⚠️  ${suspect.length} SUSPECT trip(s), |drift| summing ${totalDrift} VND.`);
    console.log('     Review the rows above, then either:');
    console.log('       • LEAVE  — if divergence is legacy direct-revenue data (acceptable), or');
    console.log('       • FIX    — via a separate signed-off data-fix script (not this tool).');
  }

  process.exit(suspect.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('❌ Audit failed:', err);
  process.exit(1);
});
