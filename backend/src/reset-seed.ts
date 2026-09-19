// Full dev-DB reset: wipe the master/ops tables in FK-safe order, then run
// the canonical seed EXPLICITLY and verify it actually repopulated.
//
// The 2026-09-19 incident this tool guards against: the old script wiped
// master data and its "reseed" was an import-for-side-effect that never ran
// (seed.ts only executes under its main-module guard) — leaving a half-empty
// database with exit 0. The tool lied about success. Rules now:
//   1. the wipe list is printed BEFORE anything is deleted,
//   2. seed() is awaited directly — never import-for-side-effect,
//   3. a failed or suspiciously short seed phase is a LOUD non-zero exit,
//   4. --dry-run prints the plan without touching a single row.
import { sql } from 'drizzle-orm';
import { db, client } from './db';
import * as s from './db/schema';
import { seed } from './seed';

/** FK-safe wipe order. Labels are table names for the log. */
export const WIPE_PLAN: Array<{ label: string; wipe: () => Promise<unknown> }> = [
  { label: 'trip_legs', wipe: () => db.delete(s.tripLegs) },
  { label: 'trip_photos', wipe: () => db.delete(s.tripPhotos) },
  // No enforced FK to trips — deleting trips orphans these silently and
  // mints invisible money rows. Sweep them WITH the trip graph.
  { label: 'trip_expenses', wipe: () => db.delete(s.tripExpenses) },
  { label: 'freight_rate_snapshots', wipe: () => db.delete(s.freightRateSnapshots) },
  { label: 'trip_containers', wipe: () => db.delete(s.tripContainers) },
  { label: 'trips', wipe: () => db.delete(s.trips) },
  { label: 'ledger', wipe: () => db.delete(s.ledger) },
  { label: 'penalties', wipe: () => db.delete(s.penalties) },
  { label: 'expense_photos', wipe: () => db.delete(s.expensePhotos) },
  { label: 'expenses', wipe: () => db.delete(s.expenses) },
  { label: 'expense_categories', wipe: () => db.delete(s.expenseCategories) },
  { label: 'pricing_tables', wipe: () => db.delete(s.pricingTables) },
  { label: 'road_allowances', wipe: () => db.delete(s.roadAllowances) },
  { label: 'drivers', wipe: () => db.delete(s.drivers) },
  { label: 'trucks', wipe: () => db.delete(s.trucks) },
  { label: 'routes', wipe: () => db.delete(s.routes) },
  { label: 'cargo_types', wipe: () => db.delete(s.cargoTypes) },
  { label: 'customers', wipe: () => db.delete(s.customers) },
  { label: 'users', wipe: () => db.delete(s.users) },
  { label: 'fuel_config', wipe: () => db.delete(s.fuelConfig) },
  { label: 'penalty_reasons', wipe: () => db.delete(s.penaltyReasons) },
];

/** Post-seed counts for the summary log + the completeness gate. */
export async function collectCounts(): Promise<Record<string, number>> {
  const real = async (label: string, table: any): Promise<[string, number]> => {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(table);
    return [label, Number(row?.n ?? 0)];
  };
  const entries = await Promise.all([
    real('users', s.users),
    real('customers', s.customers),
    real('routes', s.routes),
    real('trucks', s.trucks),
    real('drivers', s.drivers),
    real('trips', s.trips),
    real('shipments', s.shipments),
    real('forwarder_expense_types', s.forwarderExpenseTypes),
  ]);
  return Object.fromEntries(entries);
}

/** The seed phase counts as done only if the canonical base data is back. */
export function verifySeedOutcome(counts: Record<string, number>): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const requireMin = (label: string, min: number) => {
    if ((counts[label] ?? 0) < min) {
      errors.push(`${label} has ${counts[label] ?? 0} rows, expected >= ${min}`);
    }
  };
  requireMin('users', 1);
  requireMin('customers', 1);
  requireMin('routes', 1);
  requireMin('forwarder_expense_types', 8);
  return { ok: errors.length === 0, errors };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log('Reset plan — tables wiped in order:');
  for (const step of WIPE_PLAN) console.log(`  - ${step.label}`);

  if (dryRun) {
    console.log('--dry-run: nothing deleted, no seed run.');
    await client.end();
    return;
  }

  for (const step of WIPE_PLAN) {
    await step.wipe();
    console.log(`  wiped ${step.label}`);
  }
  console.log('✅ Data cleared. Running the canonical seed…');

  // The seed runs EXPLICITLY — its failure is this tool's failure.
  await seed();

  const counts = await collectCounts();
  console.log('Post-seed counts:');
  for (const [label, n] of Object.entries(counts)) console.log(`  ${label}: ${n}`);

  const outcome = verifySeedOutcome(counts);
  if (!outcome.ok) {
    console.error('❌ SEED PHASE INCOMPLETE — canonical base data is missing:');
    for (const err of outcome.errors) console.error(`  - ${err}`);
    console.error('Refusing to report success. Re-run `npx tsx src/seed.ts` and investigate.');
    await client.end();
    process.exit(1);
  }

  console.log('✅ Reset complete — canonical seed verified.');
  await client.end();
}

// Run the reset only when invoked directly (npx tsx src/reset-seed.ts).
// Without this guard, merely IMPORTING this module executes the wipe —
// the exact import-for-side-effect hazard this tool exists to prevent.
const isMainModule = process.argv[1]?.replace(/\.\w+$/, '')?.endsWith('reset-seed');
if (isMainModule) {
  main().catch(async (err) => {
    console.error('❌ Reset failed:', err);
    try { await client.end(); } catch { /* already closed */ }
    process.exit(1);
  });
}
