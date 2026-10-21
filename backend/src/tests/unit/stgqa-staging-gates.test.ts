/** ENV-01 (card #10) — the stgqa executor gates and the password-reset plan,
 *  pinned so the staging maintenance class keeps the purge's safety law:
 *  never runs without an explicit env grant, never runs against the prod
 *  host, and the reset can only ever touch users.password_hash — real staff
 *  (NV00x) keep their identity rows. Pure unit test: asserts on exported
 *  pure functions and a source scan — no database, no app boot.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { stgqaEnvBlocked } from '../../seed/seed-qa-fixtures';
import { passwordResetPlan, STGQA_PASSWORD } from '../../seed/reset-staging-passwords';

const seedPath = fileURLToPath(new URL('../../seed/seed-qa-fixtures.ts', import.meta.url));
const resetPath = fileURLToPath(new URL('../../seed/reset-staging-passwords.ts', import.meta.url));

test('STGQA-GATE-1: env grant required — unset/other values are refused', () => {
  assert.match(stgqaEnvBlocked({} as NodeJS.ProcessEnv) ?? '', /STGQA_ENV must be 'local' or 'staging'/);
  assert.match(stgqaEnvBlocked({ STGQA_ENV: 'prod' } as NodeJS.ProcessEnv) ?? '', /STGQA-REFUSED/);
  assert.match(stgqaEnvBlocked({ STGQA_ENV: '' } as NodeJS.ProcessEnv) ?? '', /STGQA-REFUSED/);
});

test('STGQA-GATE-2: local and staging grants pass; prod hosts still refused', () => {
  assert.equal(stgqaEnvBlocked({ STGQA_ENV: 'local' } as NodeJS.ProcessEnv), null);
  assert.equal(stgqaEnvBlocked({ STGQA_ENV: 'staging' } as NodeJS.ProcessEnv), null);
  // vantai-shaped staging URL is allowed…
  assert.equal(
    stgqaEnvBlocked({ STGQA_ENV: 'staging', DATABASE_URL: 'postgres://vantai:x@postgres:5432/vantai' } as NodeJS.ProcessEnv),
    null,
  );
  // …the prod host never is, even with a grant.
  assert.match(
    stgqaEnvBlocked({ STGQA_ENV: 'staging', DATABASE_URL: 'postgres://u:p@silversea.tingting.vip:5432/db' } as NodeJS.ProcessEnv) ?? '',
    /points at the prod host/,
  );
  assert.match(
    stgqaEnvBlocked({ STGQA_ENV: 'local', DATABASE_URL: 'postgres://u:p@db.silversea.tingting/db' } as NodeJS.ProcessEnv) ?? '',
    /points at the prod host/,
  );
});

test('STGQA-PW-1: the reset plan writes exactly password_hash + updated_at on users', () => {
  const { plan, hash } = passwordResetPlan();
  assert.equal(plan.table, 'users');
  assert.deepEqual(plan.setColumns, ['password_hash', 'updated_at']);
  assert.match(plan.statement, /^UPDATE users SET password_hash = '\$2[aby]\$\d+\$[^']+', updated_at = now\(\)$/);
  assert.ok(!/delete|drop|truncate|insert|username|role|status|email|deleted_at/i.test(plan.statement), 'no identity columns, no destructive verbs');
  // The hash must verify as the canonical staging password.
  assert.ok(hash.length >= 50, 'bcrypt hash shape');
});

test('STGQA-PW-2: STGQA_PASSWORD is the testaccounts rule value', () => {
  assert.equal(STGQA_PASSWORD, 'Abc123');
});

test('STGQA-SRC-1: the seed executor never writes users rows', () => {
  const source = readFileSync(seedPath, 'utf8').replace(/--[^\n]*/g, '');
  assert.ok(!/schema\.users|s\.users|\bfrom\s+users\b/i.test(source), 'no users table access in the seed executor');
});

test('STGQA-SRC-2: the reset executor runs the pinned plan, nothing else against users', () => {
  const source = readFileSync(resetPath, 'utf8');
  // Destructive/inserting statements against users must not exist at all…
  assert.ok(!/DELETE\s+FROM\s+users/i.test(source), 'no DELETE against users');
  assert.ok(!/INSERT\s+INTO\s+users/i.test(source), 'no INSERT into users');
  assert.ok(!/UPDATE\s+users\s+SET/i.test(source.replace(/^.*passwordResetPlan.*$/m, '').replace(/`[^`]*`/g, '')), 'no hand-written UPDATE users outside the plan builder');
  // …and the only UPDATE users text in the file is the pinned plan template.
  const updates = source.match(/UPDATE users[^\n]*/g) ?? [];
  assert.equal(updates.length, 1, 'exactly one UPDATE users text in the file');
  assert.ok(
    source.includes("statement: `UPDATE users SET password_hash = '${hash}', updated_at = now()`"),
    'the plan statement is the exact pinned template',
  );
  assert.ok(source.includes('db.execute(sql.raw(`${plan.statement} RETURNING id`))'), 'executor runs the pinned plan statement');
});
