/**
 * Backfill: post SERVICE_FEE (chi hộ / forwarder-advanced fee) AR ledger rows.
 *
 * WHY THIS EXISTS (read me):
 *   Migrations 0072 (enum) + 0073 (this backfill) silently failed to apply on
 *   production via `drizzle-kit migrate`. Root cause: drizzle's migrator records
 *   the migration hash in `__drizzle_migrations` *before* confirming the SQL
 *   committed; `ALTER TYPE … ADD VALUE` cannot run inside drizzle's transaction
 *   wrapper, so the statement rolled back while the hash was already recorded.
 *   Result: drizzle believes 0072/0073 are "applied" and will never re-run them,
 *   but the `txn_type` enum lacks `SERVICE_FEE` and zero SERVICE_FEE rows exist.
 *
 *   This script goes around drizzle: it idempotently adds the enum value (0072)
 *   and runs the canonical 0073 backfill SQL directly. Both statements are safe
 *   to re-run (IF NOT EXISTS / NOT EXISTS guard), so future deploys are harmless.
 *
 * SOURCE OF TRUTH: reads ../drizzle/0073_backfill_service_fee_ar.sql verbatim —
 *   do not duplicate the SQL here. If the migration file changes, this follows.
 *
 * SAFETY: append-only INSERT (no UPDATE/DELETE of ledger rows). Preview before
 *   running: see `--dry-run` mode below.
 *
 * Usage:
 *   node scripts/backfill-service-fee-ar.mjs              # apply (idempotent)
 *   node scripts/backfill-service-fee-ar.mjs --dry-run    # preview count only, no writes
 *   node scripts/backfill-service-fee-ar.mjs --status     # read-only current state
 *
 * Env: DATABASE_URL (same connection the backend app uses).
 */
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = join(__dirname, '..', 'drizzle', '0073_backfill_service_fee_ar.sql');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('✗ DATABASE_URL is not set');
  process.exit(1);
}

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run') || args.has('-n');
const STATUS_ONLY = args.has('--status');

// onnotice: silence the harmless "schema drizzle already exists"-style notices
const sql = postgres(url, { onnotice: () => {} });

function countRows(rows) {
  // postgres.js returns rows as an array tagged with a `.count` for aggregates
  const r = rows[0] || {};
  return { rows: Number(r.rows ?? r.n ?? 0), customers: Number(r.customers ?? 0), totalDebit: r.total_debit ?? null };
}

async function currentState() {
  const rows = await sql`
    SELECT count(*)::int       AS rows,
           count(DISTINCT entity_id)::int AS customers,
           COALESCE(sum(debit), 0)::bigint AS total_debit
    FROM ledger WHERE txn_type = 'SERVICE_FEE'
  `;
  return countRows(rows);
}

async function enumExists() {
  const rows = await sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_enum e
      JOIN pg_type t ON e.enumtypid = t.oid
      WHERE t.typname = 'txn_type' AND e.enumlabel = 'SERVICE_FEE'
    ) AS ok
  `;
  return Boolean(rows[0]?.ok);
}

async function main() {
  console.log('=== SERVICE_FEE (chi hộ) AR backfill ===');
  console.log(`mode: ${STATUS_ONLY ? 'STATUS-ONLY' : DRY_RUN ? 'DRY-RUN' : 'APPLY'}\n`);

  const hasEnum = await enumExists();
  // If the enum value doesn't exist yet, no SERVICE_FEE rows can exist — querying the
  // ledger with `WHERE txn_type = 'SERVICE_FEE'` would itself throw "invalid input value
  // for enum txn_type". Skip the count in that case (zeros is the correct answer).
  const before = hasEnum
    ? await currentState()
    : { rows: 0, customers: 0, totalDebit: null };
  console.log(`txn_type has SERVICE_FEE : ${hasEnum}`);
  console.log(`SERVICE_FEE rows now     : ${before.rows} across ${before.customers} customers`);
  if (before.totalDebit != null) console.log(`total debit              : ${before.totalDebit}`);

  if (STATUS_ONLY) return;

  // Preview candidates (independent of enum existence — pure join, no literal cast)
  const cand = await sql`
    SELECT count(*)::int                       AS fees,
           count(DISTINCT t.customer_id)::int  AS customers
    FROM trip_expenses te
    JOIN trips t ON t.id = te.trip_id
    WHERE t.status IN ('COMPLETED', 'LOCKED')
      AND t.deleted_at IS NULL
      AND te.approval_status = 'APPROVED'
      AND te.sell_amount::numeric > 0
  `;
  console.log(`\ncandidates (COMPLETED|LOCKED, APPROVED, sell>0): ${cand[0].fees} fees / ${cand[0].customers} customers`);

  if (DRY_RUN) {
    console.log('\n(dry-run: no changes made)');
    return;
  }

  // --- APPLY ---
  // 0072: add enum value. Must NOT run inside a transaction — postgres.js
  // autocommits each tagged-template query, so this is safe.
  if (!hasEnum) {
    await sql`ALTER TYPE "public"."txn_type" ADD VALUE IF NOT EXISTS 'SERVICE_FEE'`;
    console.log('\n✓ 0072: added SERVICE_FEE to txn_type');
  } else {
    console.log('\n• 0072: SERVICE_FEE already present, skipping');
  }

  // 0073: the canonical backfill INSERT (idempotent via NOT EXISTS composite key).
  const migrationSql = readFileSync(MIGRATION_PATH, 'utf8');
  await sql.unsafe(migrationSql);
  console.log('✓ 0073: backfill INSERT executed');

  const after = await currentState();
  console.log(`\n=== Result ===`);
  console.log(`SERVICE_FEE rows after    : ${after.rows} across ${after.customers} customers`);
  console.log(`delta                     : +${after.rows - before.rows} rows`);
  if (after.totalDebit != null) console.log(`total debit               : ${after.totalDebit}`);
}

try {
  await main();
} catch (e) {
  console.error('\n✗ FAILED:', e.message || e);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
