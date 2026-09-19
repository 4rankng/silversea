// The reset tool must never lie about success: seed() runs explicitly, the
// seed phase is verified against canonical minimums, and any shortfall is a
// non-zero exit. Pins the decision function + the CLI's failure and
// dry-run paths end to end.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { WIPE_PLAN, verifySeedOutcome } from '../reset-seed';
import { disconnectRedis } from '../lib/redis';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

after(async () => {
  await disconnectRedis();
});

describe('reset-seed tool', () => {
  test('wipe plan is unique and fully labeled', () => {
    const labels = WIPE_PLAN.map((step) => step.label);
    assert.equal(new Set(labels).size, labels.length, 'no duplicate wipe targets');
    for (const label of labels) assert.ok(label.length > 0, 'every step carries a table label');
  });

  test('canonical post-seed counts pass the completeness gate', () => {
    const outcome = verifySeedOutcome({
      users: 13, customers: 9, routes: 3, forwarder_expense_types: 10,
    });
    assert.equal(outcome.ok, true, JSON.stringify(outcome.errors));
  });

  test('missing or short base data fails the gate with named errors', () => {
    const empty = verifySeedOutcome({});
    assert.equal(empty.ok, false);
    assert.ok(empty.errors.some((e) => e.includes('users')), 'users shortfall named');

    const shortCatalog = verifySeedOutcome({
      users: 13, customers: 9, routes: 3, forwarder_expense_types: 7,
    });
    assert.equal(shortCatalog.ok, false);
    assert.ok(shortCatalog.errors.some((e) => e.includes('forwarder_expense_types has 7')), 'short catalog named');
  });

  test('a failing seed phase exits non-zero (dead DB end to end)', () => {
    const result = spawnSync('npx', ['tsx', 'src/reset-seed.ts'], {
      cwd: backendRoot,
      encoding: 'utf8',
      timeout: 90000,
      env: {
        ...process.env,
        TZ: 'UTC',
        DATABASE_URL: 'postgres://postgres:postgres@localhost:5999/no_such_db',
        REDIS_URL: 'redis://localhost:6391',
      },
    });
    assert.notEqual(result.status, 0, 'a dead DB must be a non-zero exit, not a silent pass');
  });

  test('--dry-run prints the plan and deletes nothing (exit 0)', async () => {
    const result = spawnSync('npx', ['tsx', 'src/reset-seed.ts', '--dry-run'], {
      cwd: backendRoot,
      encoding: 'utf8',
      timeout: 90000,
      env: {
        ...process.env,
        TZ: 'UTC',
        DATABASE_URL: 'postgres://postgres:postgres@localhost:5441/silversea',
        REDIS_URL: 'redis://localhost:6391',
      },
    });
    assert.equal(result.status, 0, `dry run must succeed: ${result.stderr}`);
    const out = `${result.stdout}`;
    assert.ok(out.includes('Reset plan'), 'the wipe list prints before anything happens');
    assert.ok(out.includes('--dry-run: nothing deleted'), 'the dry-run disclaimer prints');
    // The per-step wipe log is '  wiped <table>' — distinct from the plan
    // header ('tables wiped in order'), so anchor to line start + spacing.
    assert.ok(!/^  wiped /m.test(out), 'no table is actually wiped in dry-run');
    // The suite itself runs against the real dev DB — count users in-process.
    const [row] = await db.select({ n: sql`count(*)::int` }).from(s.users);
    assert.equal(Number(row.n), 13, 'user count unchanged by the dry run');
  });
});
