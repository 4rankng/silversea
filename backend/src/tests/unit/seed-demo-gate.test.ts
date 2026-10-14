// FB-061 (2026-10-14): production must never show seed rows. The demo seed
// (`pnpm seed`) refuses NODE_ENV=production unless SEED_DEMO_DATA explicitly
// opts in; dev/test seeding stays untouched. The gate is enforced inside
// seed() itself, so both the CLI entry and any imported call are covered.
// Pure unit test — seed() throws at the gate before any database touch (the
// pg pool is lazy, so importing ../seed needs no live DATABASE_URL).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { demoSeedBlocked, seed } from '../../seed';

describe('demo seed production gate (FB-061)', () => {
  it('blocks the demo seed in production without the explicit flag', () => {
    const reason = demoSeedBlocked({ NODE_ENV: 'production' });
    assert.ok(reason);
    assert.match(reason, /seed:prod/);
    assert.match(reason, /SEED_DEMO_DATA/);
  });

  it('blocks when the flag is present but not an exact truthy spelling', () => {
    // The config parseFlag law: only true/1/yes enable — "false"/"0"/"no"
    // are non-empty strings a naive boolean parse would treat as enabled.
    assert.ok(demoSeedBlocked({ NODE_ENV: 'production', SEED_DEMO_DATA: 'false' }));
    assert.ok(demoSeedBlocked({ NODE_ENV: 'production', SEED_DEMO_DATA: '0' }));
    assert.ok(demoSeedBlocked({ NODE_ENV: 'production', SEED_DEMO_DATA: 'no' }));
    assert.ok(demoSeedBlocked({ NODE_ENV: 'production', SEED_DEMO_DATA: '' }));
  });

  for (const flag of ['true', '1', 'yes']) {
    it(`allows production only with SEED_DEMO_DATA=${flag} (deliberate opt-in)`, () => {
      assert.equal(demoSeedBlocked({ NODE_ENV: 'production', SEED_DEMO_DATA: flag }), null);
    });
  }

  for (const nodeEnv of ['development', 'test', undefined]) {
    it(`allows the demo seed outside production (NODE_ENV=${nodeEnv ?? 'unset'})`, () => {
      assert.equal(demoSeedBlocked({ NODE_ENV: nodeEnv }), null);
    });
  }

  it('seed() itself refuses before any write in production', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    delete process.env.SEED_DEMO_DATA;
    try {
      await assert.rejects(seed(), /SEED_DEMO_DATA/);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });
});
