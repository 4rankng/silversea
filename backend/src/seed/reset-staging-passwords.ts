/**
 * ENV-01 staging password reset (testaccounts rule 2026-09-06, now automated).
 *
 * "EVERY account on staging AND local dev uses password Abc123. Staging is a
 * prod mirror (`make stgdb`) — after every sync, re-run the password reset
 * (bcrypt hash of Abc123 onto users.password_hash) so prod-set passwords
 * never leak into staging logins." — testplan/testaccounts.txt. Before ENV-01
 * this was a manual post-sync step that kept being forgotten; `make stgqa`
 * runs this script right after the sync.
 *
 * Identity-preserving by construction: the plan touches ONLY
 * users.password_hash (+ updated_at). No username, role, status, email or
 * deletion flag changes — real staff (NV00x) rows keep their identity and
 * only regain the Abc123 login rule.
 *
 * Usage (from backend/):
 *   STGQA_ENV=local   npx tsx src/seed/reset-staging-passwords.ts
 *   STGQA_ENV=staging (on the server, via make stgqa:
 *                     node dist/seed/reset-staging-passwords.js)
 *
 * Hard interlock, same law as purge-qa-fixtures.ts: refuses to run without
 * an explicit env grant and refuses a DATABASE_URL that points at the prod
 * host (prod passwords are prod-set; agents must never seek or reset them).
 */
import bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';
import { db, client } from '../db/index.js';
import { stgqaEnvBlocked } from './seed-qa-fixtures.js';

/** The canonical staging/local password (testplan/testaccounts.txt). */
export const STGQA_PASSWORD = 'Abc123';

/**
 * Pure description of the reset the executor applies — the unit tests pin
 * this shape so the statement can never widen into row-identity changes.
 */
export interface PasswordResetPlan {
  table: 'users';
  /** Columns the statement writes. Exactly these — nothing else. */
  setColumns: ['password_hash', 'updated_at'];
  /** SQL text with the bcrypt hash embedded (machine-generated alphabet). */
  statement: string;
}

/** Build the (pure) reset plan for a freshly computed hash. */
export function passwordResetPlan(): { plan: PasswordResetPlan; hash: string } {
  const hash = bcrypt.hashSync(STGQA_PASSWORD, 10);
  return {
    hash,
    plan: {
      table: 'users',
      setColumns: ['password_hash', 'updated_at'],
      // The hash is machine-generated bcrypt output (alphabet [./A-Za-z0-9$],
      // never a quote), so embedding it keeps one source of truth for the
      // statement the tests pin and the executor runs.
      statement: `UPDATE users SET password_hash = '${hash}', updated_at = now()`,
    },
  };
}

async function scalar(query: string): Promise<number> {
  const result = await db.execute(sql.raw(query)) as unknown;
  const list = Array.isArray(result) ? result : (result as { rows: Array<Record<string, unknown>> }).rows;
  return Number(list?.[0]?.c ?? 0);
}

async function main(): Promise<void> {
  const reason = stgqaEnvBlocked();
  if (reason) {
    console.error(reason);
    process.exit(1);
  }
  console.log(`STGQA-PWRESET-START env=${process.env.STGQA_ENV} password=${STGQA_PASSWORD}`);
  const before = await scalar(`SELECT count(*)::int AS c FROM users`);
  const { plan } = passwordResetPlan();
  const updated = await db.execute(sql.raw(`${plan.statement} RETURNING id`));
  const rows = (Array.isArray(updated) ? updated : (updated as { rows: Array<Record<string, unknown>> }).rows) ?? [];
  const distinctHashes = await scalar(`SELECT count(DISTINCT password_hash)::int AS c FROM users`);
  console.log(`STGQA-PWRESET-SUMMARY users=${before} updated=${rows.length} distinct_hashes_after=${distinctHashes}`);
  if (rows.length !== before) {
    console.error(`STGQA-PWRESET-INCOMPLETE: expected ${before} updates, got ${rows.length}`);
    process.exitCode = 2;
  }
  if (distinctHashes !== 1) {
    console.error(`STGQA-PWRESET-INCOMPLETE: users still carry ${distinctHashes} distinct password hashes`);
    process.exitCode = 2;
  }
  await client.end({ timeout: 5 });
}

// Run directly (tsx src/seed/reset-staging-passwords.ts); importable for tests.
if (process.argv[1]?.includes('reset-staging-passwords')) {
  void main();
}
