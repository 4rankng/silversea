import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/**
 * Frontend structure guard — CI wrapper (card 20261003_308).
 *
 * The guard's implementation (LOC ratchet + manifest parity + date-formatter
 * law, with the full baseline history) lives in `scripts/check-structure.mjs`
 * so the pre-commit hook runs it as plain node (~0.1s) instead of booting a
 * full vitest environment per commit — the old boot held .git/index.lock for
 * minutes and was the confirmed source of both 03-10 stale-lock incidents.
 * This wrapper keeps CI covering the exact code the hook runs.
 *
 * Ratchet rule (unchanged): FROZEN_MAX_LOC may only SHRINK; growing or adding
 * an entry is an explicit, justified contract change. The regeneration recipe
 * lives in the script's header.
 */
describe('frontend structure guard (spawned implementation)', () => {
  it('reports no violations on the current tree', () => {
    const run = spawnSync('node', ['scripts/check-structure.mjs'], { cwd: '..', encoding: 'utf8' });
    const output = `${run.stdout}\n${run.stderr}`;
    expect(run.status, output).toBe(0);
  });
});
