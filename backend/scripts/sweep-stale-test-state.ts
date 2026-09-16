/**
 * Sweep stale test state from the shared dev database before gate runs.
 *
 * Companion to docs/test-ordering-contract.md (20260916_20 item 2). The
 * integration suites share one database; cleanup registries delete rows but
 * not leftover durable-job leases or accumulated terminal rows, which is one
 * driver of the order-dependent reds documented there.
 *
 * What it does:
 *   1. Re-queues durable_effect_jobs rows stuck RUNNING with an expired
 *      lease (the worker's SKIP LOCKED scan will not pick them up again
 *      otherwise).
 *   2. Deletes terminal (SUCCEEDED/FAILED/DEAD) durable rows older than a
 *      threshold — they are inert, but they slow scans and bury signal.
 *   3. Reports (read-only) long-running advisory locks and Redis key count
 *      for manual follow-up; sweeping those needs an operator decision.
 *
 * Safe by construction: re-queue + delete-terminal only, both idempotent,
 * both no-ops on a clean database. NOT for production use.
 */
import { and, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { client, db } from '../src/db';
import * as s from '../src/db/schema';
import { config } from '../src/config';

const terminalStatuses = ['SUCCEEDED', 'FAILED', 'DEAD'] as const;

async function main() {
  const terminalBefore = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.durableEffectJobs);

  // 1. Expired RUNNING leases → back to PENDING so the scan can see them.
  const requeued = await db.update(s.durableEffectJobs)
    .set({
      status: 'PENDING',
      leaseToken: null,
      leaseExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(and(
      sql`${s.durableEffectJobs.status} = 'RUNNING'`,
      isNotNull(s.durableEffectJobs.leaseExpiresAt),
      lt(s.durableEffectJobs.leaseExpiresAt, new Date()),
    ))
    .returning({ id: s.durableEffectJobs.id });
  console.log(`requeued ${requeued.length} row(s) with expired RUNNING leases`);

  // 2. Delete terminal rows older than 24h (they are inert; frees scan space).
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const deleted = await db.delete(s.durableEffectJobs)
    .where(and(
      inArray(s.durableEffectJobs.status, [...terminalStatuses]),
      sql`coalesce(${s.durableEffectJobs.completedAt}, ${s.durableEffectJobs.createdAt}) < ${cutoff.toISOString()}::timestamptz`,
    ))
    .returning({ id: s.durableEffectJobs.id });
  console.log(`deleted ${deleted.length} terminal row(s) older than 24h`);

  // 3. Read-only reports.
  const locks = await client`
    select pid, locktype, granted, now() - xact_start as xact_age
    from pg_locks join pg_stat_activity using (pid)
    where locktype = 'advisory' and granted and now() - xact_start > interval '5 minutes'
  `;
  console.log(`advisory locks held >5min: ${locks.length}`);
  for (const lock of locks) {
    console.log(`  pid=${lock.pid} age=${lock.xact_age?.toFixed?.(0) ?? '?'}s`);
  }

  const after = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.durableEffectJobs);
  console.log(`durable_effect_jobs: ${terminalBefore[0]?.n ?? 0} → ${after[0]?.n ?? 0}`);

  await client.end({ timeout: 1 });
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  await client.end({ timeout: 1 }).catch(() => {});
  process.exit(1);
});
