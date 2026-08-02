import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';

describe('customer workflow migration safety', () => {
  it('keeps milestone uniqueness in the squashed baseline and preserves duplicate-preflight discipline in current incrementals', async () => {
    const baselinePath = path.resolve(process.cwd(), 'drizzle/0000_third_wrecking_crew.sql');
    const incrementalPath = path.resolve(process.cwd(), 'drizzle/0002_o2c_rev1_extensions.sql');
    const baseline = await readFile(baselinePath, 'utf8');
    const incremental = await readFile(incrementalPath, 'utf8');

    assert.match(
      baseline,
      /CREATE UNIQUE INDEX "shipment_milestones_trip_type_uniq" ON "shipment_milestones"[\s\S]+WHERE "shipment_milestones"\."trip_id" is not null;/,
      'the squashed baseline must keep the canonical milestone uniqueness contract',
    );

    const preflightPosition = incremental.indexOf('HAVING count(*) > 1');
    const uniqueIndexPosition = incremental.indexOf(
      'CREATE UNIQUE INDEX "lift_pricing_port_type_state_dir_date_uniq"',
    );
    assert.ok(preflightPosition >= 0, 'current incrementals must still prove duplicate-data preflights exist');
    assert.ok(uniqueIndexPosition >= 0, 'current incrementals must create their target unique index');
    assert.ok(
      preflightPosition < uniqueIndexPosition,
      'duplicate-data preflight must precede the new unique index in current incrementals',
    );
    assert.match(
      incremental,
      /RAISE EXCEPTION 'Duplicate lift-pricing matrix rows must be reconciled before applying the O2C rev1 unique constraint';/,
    );
  });
});
