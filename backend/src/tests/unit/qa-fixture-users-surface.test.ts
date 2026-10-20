/** FB-061 lan 2 (card 201026112400) — the users purge surfaces, pinned so the
 *  staging residual class cannot drift back: `e2e-dispatcher-37341` (lane
 *  prefix, short suffix) and `HAHA-email-probe2` (manual probe) escaped the
 *  epoch signature, and the demo-seed trio `cus`/`dieuvan`/`customer` carried
 *  no QA token at all. Pure unit test: asserts on registry TEXT and the pure
 *  env filter, so it needs no database.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { QA_FIXTURE_REGISTRY } from '../../seed/qa-fixture-registry';
import { surfaceAppliesToEnv } from '../../seed/purge-qa-fixtures';

const usersSurfaces = QA_FIXTURE_REGISTRY.filter((surface) => surface.table === 'users');
const [qaUsers, demoUsers] = usersSurfaces;

test('USERS-1: the registry carries exactly two users surfaces, QA lane first', () => {
  assert.equal(usersSurfaces.length, 2, `expected 2 users surfaces, got ${usersSurfaces.length}`);
  assert.ok(qaUsers, 'QA users surface exists');
  assert.ok(demoUsers, 'demo-seed users surface exists');
  assert.match(qaUsers.label, /QA users/);
  assert.match(demoUsers.label, /Demo-seed/);
});

test('USERS-2: the QA lane surface covers the escaped staging fixtures (card 201026112400)', () => {
  const p = qaUsers.predicate;
  for (const branch of [
    "username ILIKE 'e2e-%'",
    "username ILIKE 'HAHA-email-probe%'",
    // the pre-existing branches must survive the extension
    "username ILIKE 'qa%'",
    "username ~ '-[0-9]{13}-'",
    "username ILIKE '%-inv-%'",
  ]) {
    assert.ok(p.includes(branch), `users predicate must keep ${branch} — got ${p}`);
  }
  assert.equal(qaUsers.action, 'soft-delete');
});

test('USERS-3: the demo-seed surface is the exact guarded conjunct, nothing wider', () => {
  // Exact-text pin: a bare username IN (...) without the Demo-name conjunct
  // would soft-delete repurposed production logins; a bare %Demo% name match
  // would catch any real row renamed to contain "Demo".
  assert.equal(
    demoUsers.predicate,
    "(username IN ('cus', 'dieuvan', 'customer') AND full_name ILIKE '%Demo%')",
  );
  assert.equal(demoUsers.action, 'soft-delete');
});

test('USERS-4: repurposed demo accounts and the real roster are outside the demo branch', () => {
  // The demo-seed roster in backend/src/seed.ts whose full names were NOT
  // rewritten on prod (still carry "Demo"): exactly cus/dieuvan/customer.
  // Every other demo account now carries a real person's name and must never
  // appear in the branch's username list.
  const protectedAccounts = [
    'admin', 'giamdoc', 'ketoan', 'laixe', 'giaonhan',
    'samsung-cs', 'canon-cs', 'khachhang',
    'thanhdc', 'dungnv', 'dvthuc', 'thu', 'pho', 'quyet',
  ];
  const listed = demoUsers.predicate.match(/IN \(([^)]+)\)/)?.[1] ?? '';
  for (const username of protectedAccounts) {
    assert.ok(!listed.includes(`'${username}'`), `${username} must never be a demo-purge target — got ${listed}`);
  }
  for (const username of ['cus', 'dieuvan', 'customer']) {
    assert.ok(listed.includes(`'${username}'`), `${username} must be listed — got ${listed}`);
  }
});

test('USERS-5: the demo-seed surface is staging-only; the QA lane surface runs everywhere', () => {
  assert.deepEqual(demoUsers.envs, ['staging']);
  assert.equal(surfaceAppliesToEnv(demoUsers, 'staging'), true);
  assert.equal(surfaceAppliesToEnv(demoUsers, 'local'), false, 'local dev-seed logs in with the demo trio');
  assert.equal(qaUsers.envs, undefined);
  assert.equal(surfaceAppliesToEnv(qaUsers, 'local'), true);
  assert.equal(surfaceAppliesToEnv(qaUsers, 'staging'), true);
});

test('USERS-6: both users surfaces carry the load-bearing-user guards', () => {
  const expected = [
    { table: 'user_shipment_links', column: 'user_id' },
    { table: 'truck_accountant_assignments', column: 'accountant_id' },
  ];
  assert.deepEqual(qaUsers.guards, expected);
  assert.deepEqual(demoUsers.guards, expected);
});
