/**
 * SIL-752 — a trip read must never FABRICATE a trailer. QA 08/11 (staging
 * build c4cea6b6, dungnv): trip 467 (external 4GS, plate 'Bổ sung sau',
 * container 20'DC) rendered RƠ MOÓC = 40FT on /trips/467 while no trailer,
 * no truck, no driver was assigned — shapeTripRelations coerced the stored
 * NULL trailer_type into the literal '40FT'.
 *
 * Law pinned here (source scan, BE unit-only owner ruling — the service
 * imports the db): trip read shaping passes trailer_type through verbatim.
 * Shared Trip.trailerType / Trailer.type are nullable; surfaces render '—'
 * on null (BasicInfoCard already does). The write-side `|| '40FT'` defaults
 * (trip-create / trip-lifecycle-ops OWN-tractor pricing snapshots) are a
 * separate, financial decision — deliberately untouched.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const tripQueries = readFileSync(
  path.resolve(import.meta.dirname, '../../services/trip-queries.service.ts'),
  'utf8',
);

/** Slice a top-level `export function` body up to the next line-start export. */
function exportBody(source: string, name: string): string {
  const start = source.indexOf(`export function ${name}`);
  assert.ok(start > 0, `${name} must exist`);
  const after = source.slice(start + `export function ${name}`.length);
  const endRel = after.search(/^export /m);
  const block = endRel === -1 ? after : after.slice(0, endRel);
  // Strip line comments — the law notes inside the source legitimately quote
  // the banned literal, and the scan must judge code, not prose.
  return block.replace(/^\s*\/\/.*$/gm, '');
}

describe('SIL-752 — trip read shaping passes trailer_type through verbatim', () => {
  const block = exportBody(tripQueries, 'shapeTripRelations');

  it('never defaults a null trailer type to a fabricated size', () => {
    assert.ok(!block.includes("'40FT'"), 'shapeTripRelations must not invent a trailer size');
    assert.match(block, /trailerType: item\.trailerType\b/);
    assert.match(block, /type: item\.trailerType\b/);
  });

  it('the `|| \'40FT\'` read default is gone from the whole trip read layer', () => {
    const code = tripQueries.replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!code.includes("|| '40FT'"), 'no read-side 40FT fabrication may reappear');
  });
});
