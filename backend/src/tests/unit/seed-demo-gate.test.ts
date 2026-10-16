// FB-061 (2026-10-14; re-reported 2026-10-16, card 141026012010): production
// must never show seed rows. Every demo seeder refuses NODE_ENV=production
// unless SEED_DEMO_DATA explicitly opts in; dev/test seeding stays untouched.
// The gate lives in one owner (seed/demo-seed-gate.ts) that each demo
// entrypoint calls before its first write.
// Pure unit test — seed() throws at the gate before any database touch (the
// pg pool is lazy, so importing ../seed needs no live DATABASE_URL).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { demoSeedBlocked } from '../../seed/demo-seed-gate';
import { seed } from '../../seed';

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

// FB-061 re-report (card 141026012010): the 2026-10-14 fix gated `pnpm
  // seed` only. Two other demo seeders self-execute and stayed wide open —
  // `seed-dashboard.ts` (trips, ledger, expenses) and
  // `seed-demo-freight-pricing.ts` (an invented contract ladder its own header
  // marks "dev + staging ONLY"). Either could be run against a production
  // DATABASE_URL and write exactly the self-authored rows this card is about.
  //
  // The census below discovers self-executing seed modules by shape rather
  // than by name, so a future demo entrypoint cannot silently reopen the hole.
  // Two modules are deliberately excluded, and the exclusions are load-bearing:
  //  - seed-prod.ts is the sanctioned production path (master data only).
  //  - seed-cut-catalogs.ts is a deploy-time catalog cut that the Makefile
  //    runs over SSH on the server (Makefile:248). It writes catalogs, not
  //    demo rows, and runs in a production-shaped env — gating it would break
  //    every deploy. If that module ever starts writing demo rows it needs an
  //    owner decision, not a silent gate here.
  const NON_DEMO_SEEDERS: Record<string, true> = {
  'seed-prod.ts': true,
  'seed-cut-catalogs.ts': true,
};

  it('every self-executing demo seeder refuses production before its first write', () => {
    const root = resolve(import.meta.dirname, '../..');
    const found: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith('.ts') || !/seed/i.test(full)) continue;
        if (NON_DEMO_SEEDERS[entry.name]) continue;
        const source = readFileSync(full, 'utf8');
        const selfExecutes =
          source.includes('import.meta.url === `file://${process.argv[1]}`') ||
          /^main\(\)/m.test(source);
        if (selfExecutes) found.push(full);
      }
    };
    walk(root);

    // Guard against the scan silently finding nothing and passing vacuously.
    // The two modules the re-report names must both be in the census.
    assert.ok(
      found.some((f) => f.endsWith('seed-dashboard.ts')),
      'seed-dashboard.ts should be in the demo-seeder census',
    );
    assert.ok(
      found.some((f) => f.endsWith('seed-demo-freight-pricing.ts')),
      'seed-demo-freight-pricing.ts should be in the demo-seeder census',
    );
    assert.ok(found.some((f) => f.endsWith('seed.ts')), 'seed.ts should be in the census');

    for (const file of found) {
      const source = readFileSync(file, 'utf8');
      assert.ok(
        source.includes('demoSeedBlocked('),
        `${relative(root, file)} is a self-executing demo seeder with no production gate`,
      );
    }
  });

  it('gates the demo freight-pricing seeder, which is demo data by its own contract', () => {
    // The module header declares "DEMO ... dev + staging ONLY (PM decision D4)"
    // and the Makefile stages it that way, so the production refusal is the
    // missing half of a boundary that is already written down.
    const source = readFileSync(resolve(import.meta.dirname, '../../seed/seed-demo-freight-pricing.ts'), 'utf8');
    assert.match(source, /export async function seedDemoFreightPricing\(\)[\s\S]*?demoSeedBlocked\(\)/);
    // And the refusal must precede the first convergence write.
    assert.ok(
      source.indexOf('demoSeedBlocked(') < source.indexOf('await ensureVehicleSizeClasses('),
      'seed-demo-freight-pricing checks the gate after its first write',
    );
  });

  it('leaves the deploy-time catalog cut ungated so deploys keep working', () => {
    // Makefile:248 runs seed-cut-catalogs over SSH on the server. A gate here
    // would abort every deploy in a production-shaped environment, so this
    // exclusion is deliberate and asserted rather than incidental.
    const source = readFileSync(resolve(import.meta.dirname, '../../seed/seed-cut-catalogs.ts'), 'utf8');
    assert.ok(
      !source.includes('demoSeedBlocked('),
      'seed-cut-catalogs is the deploy-time catalog cut and must stay ungated',
    );
  });
});
