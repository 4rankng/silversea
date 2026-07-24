/**
 * Unit test for computeRate — the pure helper behind errorRate / fallbackRate
 * / abortRate in the chatbot metrics summary. The empty-set case (0 turns)
 * is the dashboard's "no data yet" state and MUST read as 0, not NaN/Infinity.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeRate } from '../routes/admin-chatbot-metrics.js';

describe('computeRate', () => {
  test('returns 0 when denominator is 0 (no turns yet)', () => {
    assert.equal(computeRate(5, 0), 0);
    assert.equal(computeRate(0, 0), 0);
  });

  test('returns the exact ratio for normal inputs', () => {
    assert.equal(computeRate(3, 10), 0.3);
    assert.equal(computeRate(1, 4), 0.25);
  });

  test('returns 0 when numerator is 0', () => {
    assert.equal(computeRate(0, 100), 0);
  });

  test('returns 1 when numerator equals denominator', () => {
    assert.equal(computeRate(8, 8), 1);
  });

  test('returns 0 for non-finite inputs (defensive)', () => {
    assert.equal(computeRate(Number.NaN, 10), 0);
    assert.equal(computeRate(5, Number.NaN), 0);
    assert.equal(computeRate(Number.POSITIVE_INFINITY, 10), 0);
  });
});
