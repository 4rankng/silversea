// SIL-657 (id 764) — the declaration number a writer saves at ONE store never
// reached every reader at the OTHER store. The number lives in TWO places:
// the lot-level entity rows (shipment_declarations, FB-005) and the per-cont
// attribute (shipment_containers.declarationNumber, the SIL-521 store the CUS
// line command / dispatch cells / create form write). The lot-side fan-out
// (docs → containers, SIL-166) existed, but the readers that aggregate "the
// lot's tờ khai list" read ONLY shipment_declarations — so a number the
// office saved per-cont stayed invisible on the dispatch lot payload, the
// dispatch data-status bit, and the forwarder trip pages. Same defect class
// SIL-653 fixed for the container number; the fix resolves BOTH stores at
// every lot-level declaration aggregate.
//
// Pinned here as source-wiring scans in the unit-only tree (2026-10-19 owner
// ruling: the db-bound bridges cannot boot); the SQL behavior itself runs as
// a qa/scripts integration probe against the local stack.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(join(here, relative), 'utf8');
const dispatchUtils = read('../../services/dispatch-planning-utils.service.ts');
const tripQuery = read('../../services/forwarder-trip-query.service.ts');

/** Test seam: the source slice between two exported symbols — the same
 *  convention sil653-container-number-sync.test.ts pins the bridge with. */
const sliceBetween = (source: string, start: string, end?: string) => {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `missing anchor: ${start}`);
  if (end == null) return source.slice(from);
  const to = source.indexOf(end, from);
  assert.ok(to > from, `missing end anchor: ${end}`);
  return source.slice(from, to);
};

describe('SIL-657 — the dispatch lot declaration aggregate resolves BOTH stores', () => {
  const loader = sliceBetween(dispatchUtils, 'export async function loadDeclarationNumbers', 'export function dispatchDetailDataStatusSql');

  test('loadDeclarationNumbers reads shipment_containers next to shipment_declarations', () => {
    assert.match(loader, /from\(s\.shipmentDeclarations\)/);
    assert.match(loader, /from\(s\.shipmentContainers\)/);
  });

  test('the merge mirrors distinctDeclarationNumbers: entity rows first, containers after, blank skipped', () => {
    // Docs rows are added before container rows (declaration order contract).
    assert.ok(
      loader.indexOf('for (const row of rows) add(row.shipmentId') < loader.indexOf('for (const row of containerRows) add(row.shipmentId'),
      'entity numbers must merge before per-cont numbers',
    );
    // The FB-109-adjacent blank guard: a whitespace-only value never enters.
    assert.match(loader, /const value = raw\?\.trim\(\);\s*\n\s*if \(!value\) return;/);
  });

  test('dedup is case-insensitive — the entity copy wins, the container copy folds away', () => {
    assert.match(loader, /const key = value\.toLowerCase\(\);/);
    assert.match(loader, /if \(seenForLot\.has\(key\)\) return;/);
  });
});

describe('SIL-657 — the dispatch data-status tờ khai bit covers both stores', () => {
  const statusSql = sliceBetween(dispatchUtils, 'export function dispatchDetailDataStatusSql', 'export function toFrozenSiteSummary');

  test('MISSING no longer fires for a lot whose number exists ONLY per-cont', () => {
    // Card 261013200312 (one lot-scoped bit across both stores) applied to the
    // dispatch side: the declaration arm is a CONJUNCTION of the two negated
    // EXISTS arms — docs AND containers must both be empty for MISSING.
    assert.match(statusSql, /not exists \(select 1 from \$\{s\.shipmentDeclarations\} sd/);
    assert.match(statusSql, /and not exists \(select 1 from \$\{s\.shipmentContainers\} sc/);
  });
});

describe('SIL-657 — the forwarder trip pages resolve both stores', () => {
  test('the shared aggregate rides one fragment wired into BOTH select sites', () => {
    const fragment = sliceBetween(tripQuery, 'const lotDeclarationNumbersSql', 'function withinForwarderScope');
    assert.match(fragment, /FROM shipment_declarations sd/);
    assert.match(fragment, /FROM shipment_containers sc/);
    // DISTINCT case-insensitively, entity casing kept: first occurrence per
    // lower(...) partition wins (entity rows sort before containers).
    assert.match(fragment, /PARTITION BY lower\(raw\.declaration_number\)/);
    assert.match(fragment, /WHERE kept\.rn = 1/);
    assert.match(fragment, /WHERE raw\.declaration_number <> ''/);
    // Both select sites replaced — zero docs-only string_agg left.
    assert.equal((tripQuery.match(/string_agg\(sd\.declaration_number/g) ?? []).length, 0);
    assert.equal((tripQuery.match(/lotDeclarationNumbersSql\(sql/g) ?? []).length, 2);
  });

  test('the trips search predicate matches a per-cont declaration number too', () => {
    assert.match(tripQuery, /sc\.container_number ILIKE \$\{term\} OR sc\.declaration_number ILIKE \$\{term\}/);
  });
});

describe('SIL-657 — write laws untouched (regression guard)', () => {
  test('the lot-side fan-out and the per-cont command keep their FB-109 owner pins', () => {
    const writes = read('../../services/cus-shipment-workspace-writes.service.ts');
    const lineUpdateFlow = writes.slice(
      writes.indexOf('export async function updateCusShipmentContainerLine'),
      writes.indexOf('export async function addCusShipmentContainer'),
    );
    assert.match(lineUpdateFlow, /IS NULL OR btrim\(\$\{s\.shipmentContainers\.declarationNumber\}\) = ''/);
    // The read-side merge adds NO new writer: the line command still writes
    // exactly the container store (no shipment_declarations insert appears).
    assert.doesNotMatch(lineUpdateFlow, /insert\(s\.shipmentDeclarations\)/);
  });
});
