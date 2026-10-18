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
import { eq } from 'drizzle-orm';
import * as s from '../db/schema';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEV_URL = 'postgres://postgres:postgres@localhost:5441/silversea';

// Contention-safe wipe detection: the shared dev DB is written by other
// suites concurrently, so GLOBAL table counts are not a stable invariant (a
// foreign suite's insert reddens the pin without any fault here). The suite
// owns sentinel rows instead — the wipe plan deletes ALL rows of these
// tables, so an import that actually wiped anything would take the
// sentinels with it. Same detection power, no foreign-write noise.
const sentinelSuffix = `import-inert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let sentinelUserId = 0;
let sentinelCustomerId = 0;
let sentinelRouteId = 0;

async function createSentinels(): Promise<void> {
  const [u] = await db.insert(s.users).values({
    username: sentinelSuffix,
    passwordHash: 'x',
    status: 'ACTIVE',
  }).returning();
  sentinelUserId = u.id;
  const [c] = await db.insert(s.customers).values({ name: sentinelSuffix }).returning();
  sentinelCustomerId = c.id;
  const [r] = await db.insert(s.routes).values({ name: sentinelSuffix }).returning();
  sentinelRouteId = r.id;
}

async function sentinelsSurvived(): Promise<boolean> {
  const [u] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.id, sentinelUserId));
  const [c] = await db.select({ id: s.customers.id }).from(s.customers).where(eq(s.customers.id, sentinelCustomerId));
  const [r] = await db.select({ id: s.routes.id }).from(s.routes).where(eq(s.routes.id, sentinelRouteId));
  return Boolean(u && c && r);
}

async function cleanupSentinels(): Promise<void> {
  await db.delete(s.users).where(eq(s.users.id, sentinelUserId));
  await db.delete(s.customers).where(eq(s.customers.id, sentinelCustomerId));
  await db.delete(s.routes).where(eq(s.routes.id, sentinelRouteId));
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
  try {
    await cleanupSentinels();
  } catch {
    // best-effort: the happy path already cleans up inside the test
  }
  await client.end();
});

describe('tool executables are import-inert', () => {
  test('importing reset-seed and seed writes nothing to the database', async () => {
    await createSentinels();
    const r = importBoth();
    assert.equal(r.status, 0, `imports must succeed: ${r.stderr}`);
    assert.ok(!r.stderr.includes('Reset plan'), 'the reset wipe list must NOT run on import');
    assert.ok(await sentinelsSurvived(), 'sentinel rows must survive the bare imports');
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
