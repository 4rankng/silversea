/**
 * Wipe business data (users/auth preserved) and reseed from scratch.
 *
 * Dry-run by default: prints the table groups that would be truncated.
 * `--apply` performs the wipe then runs the full seed flow (same modules
 * `pnpm --dir backend seed` uses) so the result matches the canonical path.
 *
 * Run: cd backend && npx tsx scripts/wipe-and-reseed.ts [--apply]
 */
import { db, client } from '../src/db';
import { executeWipe, planWipe } from '../src/seed/wipe';
import { seed } from '../src/seed';

const APPLY = process.argv.includes('--apply');

async function main() {
  const plan = planWipe();
  const tableCount = Object.values(plan.wipe).flat().length;
  console.log(`Wipe plan: ${tableCount} tables across ${Object.keys(plan.wipe).length} groups`);
  console.log(`Preserved: ${plan.preserved.join(', ')}`);

  if (!APPLY) {
    for (const [group, tables] of Object.entries(plan.wipe)) {
      console.log(`  [${group}] ${tables.join(', ')}`);
    }
    console.log('\nDry-run only. Re-run with --apply to truncate + reseed.');
    return;
  }

  const truncated = await executeWipe(db);
  console.log(`\n✅ Wiped ${truncated} tables (RESTART IDENTITY CASCADE).`);

  await seed();
}

main()
  .catch((error) => {
    console.error('wipe-and-reseed failed:', error);
    if (error?.cause) console.error('Caused by:', error.cause);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end();
  });
