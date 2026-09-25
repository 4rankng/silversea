/**
 * QA-fixture purge executor (cards 20260925_41-45).
 *
 * Executes QA_FIXTURE_REGISTRY against the configured DATABASE_URL. Census
 * first, guarded deletes, re-census to zero — and it refuses to run against
 * prod outright. The data class is defined by the registry, never by bulk
 * name matching at run time.
 *
 * Usage (from backend/):
 *   QA_PURGE_ENV=local   pnpm exec tsx src/seed/purge-qa-fixtures.ts [--dry-run]
 *   QA_PURGE_ENV=staging pnpm exec tsx src/seed/purge-qa-fixtures.ts [--dry-run]
 *
 * On staging the compiled copy runs inside the backend container (the same
 * way seed-cut-catalogs.js runs from the demo deploy target).
 */
import { sql } from 'drizzle-orm';
import { db, client } from '../db/index.js';
import { QA_FIXTURE_REGISTRY, type QaFixtureSurface } from './qa-fixture-registry.js';

const isDryRun = process.argv.includes('--dry-run');

/** Hard interlock: the purge never runs without an explicit env grant. */
function assertEnvAllowed(): void {
  const env = process.env.QA_PURGE_ENV;
  if (env !== 'local' && env !== 'staging') {
    console.error(`QA-PURGE-REFUSED: QA_PURGE_ENV must be 'local' or 'staging' (got '${env ?? 'unset'}')`);
    process.exit(1);
  }
  const url = process.env.DATABASE_URL ?? '';
  if (/silversea\.tingting/.test(url)) {
    console.error('QA-PURGE-REFUSED: DATABASE_URL points at the prod host — the purge never touches prod.');
    process.exit(1);
  }
}

/** Run a raw statement and return its rows (generic shape). */
async function rows(query: string): Promise<Array<Record<string, unknown>>> {
  const result = await db.execute(sql.raw(query)) as unknown;
  const list = Array.isArray(result) ? result : (result as { rows: Array<Record<string, unknown>> }).rows;
  return list ?? [];
}

/** Census: rows matching a surface predicate right now. */
export async function censusSurface(surface: QaFixtureSurface): Promise<number> {
  const found = await rows(`SELECT count(*)::int AS count FROM ${surface.table} WHERE ${surface.predicate}`);
  return Number(found[0].count);
}

/** Census filtered to APP-VISIBLE rows: soft-deleted rows still match the
 *  identifier predicate but no page renders them, so counting them made the
 *  re-census report purged surfaces as remaining (cut #9 deploy log). */
export async function censusVisible(surface: QaFixtureSurface): Promise<number> {
  if (!(await columnExists(surface.table, 'deleted_at'))) return censusSurface(surface);
  const found = await rows(`SELECT count(*)::int AS count FROM ${surface.table} WHERE ${surface.predicate} AND deleted_at IS NULL`);
  return Number(found[0].count);
}

/** Referencing rows that block a guarded delete of `id`. */
/** The referencing column may not exist on older schema versions - inert then. */
async function columnExists(table: string, column: string): Promise<boolean> {
  const check = await rows(`SELECT 1 AS hit FROM information_schema.columns WHERE table_name = '${table}' AND column_name = '${column}'`);
  return check.length > 0;
}

async function isGuarded(surface: QaFixtureSurface, id: number): Promise<boolean> {
  for (const guard of surface.guards) {
    if (!(await columnExists(guard.table, guard.column))) continue;
    const check = await rows(`SELECT 1 AS hit FROM ${guard.table} WHERE ${guard.column} = ${id} LIMIT 1`);
    if (check.length > 0) return true;
  }
  return false;
}

/** Reversal rows go first so an original and its reversal delete together. */
export async function purgeSurface(surface: QaFixtureSurface, dryRun: boolean): Promise<{ matched: number; deleted: number; skipped: number }> {
  const matched = await censusSurface(surface);
  if (matched === 0) return { matched: 0, deleted: 0, skipped: 0 };
  if (dryRun) return { matched, deleted: 0, skipped: 0 };

  let deleted = 0;
  let skipped = 0;

  if (surface.action === 'soft-delete') {
    const res = await rows(`UPDATE ${surface.table} SET deleted_at = now() WHERE ${surface.predicate} AND deleted_at IS NULL RETURNING id`);
    deleted = res.length;
  } else if (surface.action === 'deactivate-plus-soft-delete') {
    const res = await rows(`UPDATE ${surface.table} SET status = 'INACTIVE', deleted_at = now() WHERE ${surface.predicate} AND (deleted_at IS NULL OR status <> 'INACTIVE') RETURNING id`);
    deleted = res.length;
  } else if (surface.action === 'deactivate') {
    const res = await rows(`UPDATE ${surface.table} SET status = 'INACTIVE' WHERE ${surface.predicate} AND status <> 'INACTIVE' RETURNING id`);
    deleted = res.length;
  } else if (surface.action === 'scrub') {
    for (const column of surface.scrubColumns ?? []) {
      if (!(await columnExists(surface.table, column))) continue;
      const res = await rows(`UPDATE ${surface.table} SET ${column} = NULL WHERE ${surface.predicate} RETURNING id`);
      deleted += res.length;
    }
  } else {
    // Hard delete, row by row, guards first; reversal rows before originals.
    const idRows = await rows(`SELECT id FROM ${surface.table} WHERE ${surface.predicate} ORDER BY id DESC`);
    for (const row of idRows) {
      const id = Number(row.id);
      try {
        if (surface.action === 'hard-delete-guarded' && surface.selfGuard) {
          const selfHit = await rows(`SELECT 1 AS hit FROM ${surface.table} WHERE id = ${id} AND ${surface.selfGuard} LIMIT 1`);
          if (selfHit.length > 0) { skipped += 1; continue; }
        }
        if (surface.action === 'hard-delete-guarded' && await isGuarded(surface, id)) { skipped += 1; continue; }
        await rows(`DELETE FROM ${surface.table} WHERE id = ${id}`);
        deleted += 1;
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === '23503') { skipped += 1; continue; }
        throw error;
      }
    }
  }
  return { matched, deleted, skipped };
}

/** Purge the whole registry: census -> guarded purge -> re-census. */
export async function purgeAll(dryRun: boolean): Promise<Array<{ table: string; label: string; action: string; matched: number; deleted: number; skipped: number; remaining: number }>> {
  const report: Array<{ table: string; label: string; action: string; matched: number; deleted: number; skipped: number; remaining: number }> = [];
  for (const surface of QA_FIXTURE_REGISTRY) {
    const result = await purgeSurface(surface, dryRun);
    const remaining = await censusVisible(surface);
    report.push({ table: surface.table, label: surface.label, action: surface.action, ...result, remaining });
    console.log(`SURFACE ${surface.table} [${surface.action}] matched=${result.matched} deleted=${result.deleted} skipped=${result.skipped} remaining=${remaining}`);
  }
  return report;
}

async function main(): Promise<void> {
  assertEnvAllowed();
  console.log(`QA-PURGE-START ${isDryRun ? 'DRY-RUN' : 'EXECUTE'} env=${process.env.QA_PURGE_ENV}`);
  const report = await purgeAll(isDryRun);
  const totalDeleted = report.reduce((sum, row) => sum + row.deleted, 0);
  const totalRemaining = report.reduce((sum, row) => sum + row.remaining, 0);
  console.log(`QA-PURGE-SUMMARY deleted=${totalDeleted} remaining=${totalRemaining}`);
  await client.end({ timeout: 5 });
  if (totalRemaining > 0) {
    console.error('QA-PURGE-INCOMPLETE: some surfaces still hold QA rows (guarded skips) — see SURFACE lines above.');
    process.exitCode = 2;
  }
}

// Run directly (tsx src/seed/purge-qa-fixtures.ts); importable for tests.
if (process.argv[1]?.includes('purge-qa-fixtures')) {
  void main();
}
