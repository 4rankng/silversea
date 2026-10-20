import assert from 'node:assert/strict';
import test from 'node:test';

import { durationStringToSeconds } from '../../lib/duration';

test('durationStringToSeconds parses the deployed JWT_EXPIRES_IN vocabulary', () => {
  // Config default and both server setup scripts pin '7d'.
  assert.equal(durationStringToSeconds('7d'), 604_800);
  assert.equal(durationStringToSeconds('24h'), 86_400);
  assert.equal(durationStringToSeconds('3600s'), 3_600);
  assert.equal(durationStringToSeconds('30m'), 1_800);
  assert.equal(durationStringToSeconds('1w'), 604_800);
  assert.equal(durationStringToSeconds('1y'), 31_536_000);
});

test('a bare number means seconds (ms package semantics)', () => {
  assert.equal(durationStringToSeconds('120'), 120);
  assert.equal(durationStringToSeconds('0'), 0);
});

test('fractional values floor to whole seconds', () => {
  assert.equal(durationStringToSeconds('1.5d'), 129_600);
  assert.equal(durationStringToSeconds('0.5h'), 1_800);
});

test('surrounding whitespace is trimmed', () => {
  assert.equal(durationStringToSeconds(' 7d '), 604_800);
});

test('unparseable input returns null instead of guessing', () => {
  assert.equal(durationStringToSeconds(''), null);
  assert.equal(durationStringToSeconds('soon'), null);
  assert.equal(durationStringToSeconds('7days'), null);
  assert.equal(durationStringToSeconds('-5m'), null);
  assert.equal(durationStringToSeconds('1m30s'), null);
});
