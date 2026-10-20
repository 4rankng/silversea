/** FB-061 lan 3 (card 201026112400) — the demo-seed business-unit purge
 *  surfaces, pinned so the staging /users residual cannot drift back: the
 *  "Đơn vị phụ trách" catalog on /users renders every business_units row
 *  (admin lifecycle surface, listBusinessUnits() has no status filter), and
 *  staging (prod-mirror) still carried the seed unit CUS-DEMO /
 *  "Đơn vị CUS Demo" after lan 2 cleaned the user rows. Lan 2's UI drive
 *  asserted the paginated rows only, which is why the catalog residual
 *  passed. Pure unit test: asserts on registry TEXT, the pure env filter,
 *  execution ORDER, and a source-scan of the seed literal — no database.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { QA_FIXTURE_REGISTRY } from '../../seed/qa-fixture-registry';
import { surfaceAppliesToEnv } from '../../seed/purge-qa-fixtures';

const linkSurfaces = QA_FIXTURE_REGISTRY.filter((surface) => surface.table === 'user_business_unit_links');
const unitSurfaces = QA_FIXTURE_REGISTRY.filter((surface) => surface.table === 'business_units');
const qaLinks = linkSurfaces[0];
const demoLinks = linkSurfaces[1];
const qaUnits = unitSurfaces[0];
const demoUnits = unitSurfaces[1];

/** The exact seed literal pair from backend/src/seed.ts seedClerkScope(). */
const SEED_CODE = 'CUS-DEMO';
const SEED_NAME = 'Đơn vị CUS Demo';

test('BUDEMO-1: registry carries QA + demo surfaces for links and units, QA family first', () => {
  assert.equal(linkSurfaces.length, 2, `expected 2 user_business_unit_links surfaces, got ${linkSurfaces.length}`);
  assert.equal(unitSurfaces.length, 2, `expected 2 business_units surfaces, got ${unitSurfaces.length}`);
  assert.match(qaLinks.label, /QA-named business units|QA-user links/i);
  assert.match(qaUnits.label, /QA-named business units/i);
  assert.match(demoLinks.label, /demo-seed CUS business unit/i);
  assert.match(demoUnits.label, /Demo-seed CUS business unit/i);
});

test('BUDEMO-2: the demo unit branch is the exact seed literal pair, nothing wider', () => {
  // Exact-text pin: `=` (not ILIKE, not LIKE) so a unit an admin creates
  // later ('Đơn vị CUS Demo 2', 'cus-demo') can never match; the literals
  // must stay byte-identical to seed.ts seedClerkScope().
  assert.equal(demoUnits.predicate, `code = '${SEED_CODE}' OR name = '${SEED_NAME}'`);
  assert.ok(!demoUnits.predicate.includes('ILIKE'), 'demo unit branch must not widen with ILIKE');
  assert.equal(demoUnits.action, 'hard-delete');
  assert.deepEqual(demoUnits.guards, []);
});

test('BUDEMO-3: the demo link branch deletes links THROUGH the same unit identity, children-first', () => {
  // Exact-text pin (same discipline as BUDEMO-2): an appended branch must
  // fail this pin instead of silently widening the purge.
  assert.equal(
    demoLinks.predicate,
    `business_unit_id IN (SELECT id FROM business_units WHERE code = '${SEED_CODE}' OR name = '${SEED_NAME}')`,
  );
  assert.equal(demoLinks.action, 'hard-delete');
  assert.deepEqual(demoLinks.guards, []);
});

test('BUDEMO-4: both demo surfaces are staging-only; the QA% surfaces run everywhere', () => {
  assert.deepEqual(demoLinks.envs, ['staging']);
  assert.deepEqual(demoUnits.envs, ['staging']);
  assert.equal(surfaceAppliesToEnv(demoLinks, 'staging'), true);
  assert.equal(surfaceAppliesToEnv(demoLinks, 'local'), false, 'local dev-seed links the demo cus clerk to CUS-DEMO');
  assert.equal(surfaceAppliesToEnv(demoUnits, 'staging'), true);
  assert.equal(surfaceAppliesToEnv(demoUnits, 'local'), false);
  assert.equal(qaUnits.envs, undefined);
  assert.equal(qaLinks.envs, undefined);
  assert.equal(surfaceAppliesToEnv(qaUnits, 'local'), true);
  assert.equal(surfaceAppliesToEnv(qaUnits, 'staging'), true);
});

test('BUDEMO-5: execution order — QA links, QA units, demo links, demo unit', () => {
  // Array order is executor order (purgeAll iterates QA_FIXTURE_REGISTRY).
  // The demo link delete must precede the demo unit delete so no link row
  // dangles behind a deleted unit id mid-purge; both demo surfaces sit after
  // the whole QA family so the QA% deletes never observe demo-surface state.
  const indexOf = (surface: typeof qaUnits) => QA_FIXTURE_REGISTRY.indexOf(surface);
  assert.ok(indexOf(qaLinks) < indexOf(qaUnits), 'QA links before QA units (children-first)');
  assert.ok(indexOf(qaUnits) < indexOf(demoLinks), 'QA family before the lan-3 demo surfaces');
  assert.ok(indexOf(demoLinks) < indexOf(demoUnits), 'demo links before the demo unit (children-first)');
});

test('BUDEMO-6: seed literal drift pin — seedClerkScope must keep writing the purged identity', () => {
  // If the seed ever renames the demo unit, this pin forces the registry
  // predicates above to follow in the same commit, otherwise the purge
  // silently stops matching the class it was written for.
  const seedSource = readFileSync(fileURLToPath(new URL('../../seed.ts', import.meta.url)), 'utf8');
  const start = seedSource.indexOf('export async function seedClerkScope');
  assert.ok(start >= 0, 'seedClerkScope must exist in backend/src/seed.ts');
  // Bound the scan to the function body: a top-level '\n}\n' closes it, so a
  // stray literal AFTER the function can no longer satisfy this pin.
  const end = seedSource.indexOf('\n}\n', start);
  assert.ok(end > start, 'seedClerkScope body must be closable');
  const clerkScope = seedSource.slice(start, end);
  assert.ok(clerkScope.includes(`code: '${SEED_CODE}'`), `seedClerkScope must write code ${SEED_CODE}`);
  assert.ok(clerkScope.includes(`name: '${SEED_NAME}'`), `seedClerkScope must write name ${SEED_NAME}`);
});
