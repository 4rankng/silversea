// Regression pin for the import-for-side-effect hazard: merely importing
// the tool executables (reset-seed, seed) must execute NOTHING — the wipe
// and the seed run only under their main-module guards. Catches any
// regression of the b3e15921 guard class.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { db, client } from '../db';
import { sql } from 'drizzle-orm';
import * as s from '../db/schema';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEV_URL = 'postgres://postgres:postgres@localhost:5441/silversea';

async function fingerprint(): Promise<string> {
  const targets: Array<[string, unknown]> = [
    ['users', s.users],
    ['customers', s.customers],
    ['routes', s.routes],
    ['shipments', s.shipments],
    ['trips', s.trips],
    ['forwarder_expense_types', s.forwarderExpenseTypes],
  ];
  const parts: string[] = [];
  for (const [label, table] of targets) {
    const [row] = await db.select({ n: sql`count(*)::int` }).from(table as never);
    parts.push(`${label}:${(row as { n: number }).n}`);
  }
  return parts.join('|');
}

// Import both executables inside a CHILD process (an import in THIS process
// would be optimized away by the bundler's module cache and prove nothing).
function importBoth(): { status: number | null; stderr: string } {
  const r = spawnSync('npx', ['tsx', '--input-type=module', '-e',
    `await import('./src/reset-seed.ts'); await import('./src/seed.ts'); console.log('imports done');`], {
    cwd: backendRoot, encoding: 'utf8', timeout: 120000,
    env: { ...process.env, TZ: 'UTC', DATABASE_URL: DEV_URL, REDIS_URL: 'redis://localhost:6391' },
  });
  return { status: r.status, stderr: r.stderr };
}

before(async () => {});

after(async () => {
  await client.end();
});

describe('tool executables are import-inert', () => {
  test('importing reset-seed and seed writes nothing to the database', async () => {
    const before = await fingerprint();
    const r = importBoth();
    assert.equal(r.status, 0, `imports must succeed: ${r.stderr}`);
    assert.ok(!r.stderr.includes('Reset plan'), 'the reset wipe list must NOT run on import');
    const after = await fingerprint();
    assert.equal(after, before, 'database row fingerprint must be identical after import');
  });

  test('direct CLI invocation still executes (guard does not over-block)', () => {
    const r = spawnSync('npx', ['tsx', 'src/reset-seed.ts', '--dry-run'], {
      cwd: backendRoot, encoding: 'utf8', timeout: 90000,
      env: { ...process.env, TZ: 'UTC', DATABASE_URL: DEV_URL, REDIS_URL: 'redis://localhost:6391' },
    });
    assert.equal(r.status, 0, `direct run must work: ${r.stderr}`);
    assert.ok(`${r.stdout}`.includes('Reset plan'), 'the wipe plan prints on direct run');
  });
});
