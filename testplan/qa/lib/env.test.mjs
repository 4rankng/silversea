import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAccountsTxt } from './env.mjs';

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
