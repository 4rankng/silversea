import { readFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

// 20260918_12 regression pin: drizzle-kit must never default to a hardcoded
// sibling-checkout database again (the 5442 default caused the 155-red
// incident). The config requires an explicit DATABASE_URL for any command
// that touches a database; `generate` (which never connects) gets a
// placeholder. Source-level pin because the failure mode is the config file
// itself drifting back.

const configSource = readFileSync(
  path.resolve(import.meta.dirname, '../../../drizzle.config.ts'),
  'utf8',
);

test('drizzle config contains no hardcoded fallback database port', () => {
  assert.ok(!configSource.includes('5442'), 'the sibling-checkout port 5442 must never reappear in drizzle.config.ts');
  assert.ok(!/localhost:\d+\/silversea/.test(configSource.replace(/placeholder[^\n]*/, '')), 'no hardcoded default database URL outside the generate placeholder');
});

test('drizzle config fails loudly when DATABASE_URL is missing for DB-touching commands', () => {
  assert.match(configSource, /process\.env\.DATABASE_URL/, 'must read DATABASE_URL from the environment');
  assert.match(configSource, /refusing to guess a database/, 'the fail-loud warning must be present');
  assert.match(configSource, /process\.exit\(1\)/, 'must exit non-zero without DATABASE_URL');
  assert.match(configSource, /command === 'generate'/, 'only generate (no connection) may use a placeholder');
});
