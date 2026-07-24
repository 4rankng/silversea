import { test, describe } from 'node:test';
import assert from 'node:assert';
import { round2dp, roundInt } from './round.ts';

describe('round2dp', () => {
  test('basic rounding: 1.005 rounds to 1.01 (banker-safe)', () => {
    assert.strictEqual(round2dp(1.005), 1.01);
  });

  test('basic rounding: 1.004 rounds to 1.00', () => {
    assert.strictEqual(round2dp(1.004), 1.0);
  });

  test('basic rounding: 2.345 rounds to 2.35', () => {
    assert.strictEqual(round2dp(2.345), 2.35);
  });

  test('basic rounding: 2.344 rounds to 2.34', () => {
    assert.strictEqual(round2dp(2.344), 2.34);
  });

  test('edge case: 0 passes through', () => {
    assert.strictEqual(round2dp(0), 0);
  });

  test('edge case: negative number rounds correctly', () => {
    assert.strictEqual(round2dp(-1.005), -1.01);
    assert.strictEqual(round2dp(-1.004), -1.0);
    assert.strictEqual(round2dp(-2.345), -2.35);
  });

  test('edge case: very large numbers', () => {
    assert.strictEqual(round2dp(999999999.995), 1000000000.0);
    assert.strictEqual(round2dp(999999999.994), 999999999.99);
  });

  test('already-round numbers pass through', () => {
    assert.strictEqual(round2dp(1.0), 1.0);
    assert.strictEqual(round2dp(42.5), 42.5);
    assert.strictEqual(round2dp(100.12), 100.12);
  });

  test('rounding at 0.5 boundary', () => {
    assert.strictEqual(round2dp(0.005), 0.01);
    assert.strictEqual(round2dp(0.004), 0.0);
  });

  test('VND-scale numbers (millions)', () => {
    assert.strictEqual(round2dp(12345678.895), 12345678.9);
    assert.strictEqual(round2dp(5000000.005), 5000000.01);
  });

  test('floating-point edge: 0.1 + 0.2', () => {
    // 0.1 + 0.2 = 0.30000000000000004 in JS → should round to 0.30
    assert.strictEqual(round2dp(0.1 + 0.2), 0.3);
  });
});

describe('roundInt', () => {
  test('basic rounding: 1.5 rounds to 2', () => {
    assert.strictEqual(roundInt(1.5), 2);
  });

  test('basic rounding: 1.4 rounds to 1', () => {
    assert.strictEqual(roundInt(1.4), 1);
  });

  test('basic rounding: 97.2 rounds to 97', () => {
    assert.strictEqual(roundInt(97.2), 97);
  });

  test('basic rounding: 97.9 rounds to 98', () => {
    assert.strictEqual(roundInt(97.9), 98);
  });

  test('negative numbers clamp to 0', () => {
    assert.strictEqual(roundInt(-5.7), 0);
    assert.strictEqual(roundInt(-1), 0);
    assert.strictEqual(roundInt(-0.5), 0);
    assert.strictEqual(roundInt(-100), 0);
  });

  test('very large numbers', () => {
    assert.strictEqual(roundInt(999999999.7), 1000000000);
    assert.strictEqual(roundInt(999999999.2), 999999999);
  });

  test('already-integer values pass through', () => {
    assert.strictEqual(roundInt(0), 0);
    assert.strictEqual(roundInt(42), 42);
    assert.strictEqual(roundInt(1000), 1000);
  });

  test('0.5 rounds up to 1', () => {
    assert.strictEqual(roundInt(0.5), 1);
  });

  test('0.4 rounds down to 0', () => {
    assert.strictEqual(roundInt(0.4), 0);
  });

  test('0 passes through', () => {
    assert.strictEqual(roundInt(0), 0);
  });
});
