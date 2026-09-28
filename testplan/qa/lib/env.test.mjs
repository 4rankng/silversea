import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAccountsTxt, missingRoleError, blockedForMissingRole } from './env.mjs';
import { tagNonPassErrors } from './env-tag.mjs';

// Card _46: prose prefixes on a role line must never become username
// candidates — the DRIVER line used to start with "38 named drivers…",
// which the comma-split turned into the candidate "38".
const txt = [
  'local:',
  '  baseUrl: http://localhost:7174',
  '    ADMIN:       admin, phuongnt (NV001)',
  '    DRIVER:      bqhuong, btdung, vvtrung, tvtham — 38 named drivers',
  '                 (no Mã NV); every one logs in with username + Abc123',
  '    OPS:         hoangnh (NV003), hungld (NV004)',
  'staging:',
  '    DRIVER:      38 named drivers (no Mã NV) — e.g. bqhuong, btdung',
  '    ACC:         (empty role line)',
].join('\n');

test('keeps letter-initial candidates and drops prose/count prefixes', () => {
  const accounts = parseAccountsTxt(txt);
  assert.deepEqual(accounts.local.ADMIN, ['admin', 'phuongnt']);
  assert.deepEqual(accounts.local.DRIVER, ['bqhuong', 'btdung', 'vvtrung', 'tvtham']);
  assert.deepEqual(accounts.local.OPS, ['hoangnh', 'hungld']);
});

test('old prose-first format loses the first listed driver but stays parseable', () => {
  const old = parseAccountsTxt(['staging:', '    DRIVER:      38 named drivers (no Mã NV) — e.g. bqhuong, btdung'].join('\n'));
  // "e.g." shares the first comma entry with the prose prefix, so that whole
  // entry (and bqhuong inside it) is filtered — this is why the fixture file
  // now lists usernames FIRST.
  assert.deepEqual(old.staging.DRIVER, ['btdung']);
});

// Card 20260928_157: CUSTOMER is local-only, so pointing a runner at staging
// used to kill the whole topic with `FATAL no username for role CUSTOMER`
// (exit 2) — a crash, not a verdict. The role gap is now a marked error the
// runners turn into a BLOCKED result.
test('a role the env has no account for raises a marked error, not a bare throw', () => {
  const err = missingRoleError('CUSTOMER', 'staging');
  assert.equal(err.code, 'NO_ROLE_CANDIDATES');
  assert.equal(err.role, 'CUSTOMER');
  assert.match(err.message, /no username for role CUSTOMER in env staging/);
});

test('the missing-role result is BLOCKED and leads with the env', () => {
  const blocked = blockedForMissingRole('CUSTOMER', 'staging');
  assert.equal(blocked.verdict, 'BLOCKED');
  assert.equal(blocked.errors.length, 1);
  assert.ok(blocked.errors[0].startsWith('[staging] '), 'the env must lead the message');
});

test('the runner boundary does not double-tag the missing-role BLOCKED', () => {
  const blocked = blockedForMissingRole('CUSTOMER', 'staging');
  tagNonPassErrors(blocked, { env: 'staging' });
  const tags = [...blocked.errors[0].matchAll(/\[\s*(?:local|staging)\s*\]/g)];
  assert.equal(tags.length, 1, 'exactly one env tag, not two');
});
