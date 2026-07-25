/**
 * Wave 1 M12.3 — pump OCR cross-check logic tests.
 *
 * Tests the pure-function crossCheckPumpReading without needing an actual
 * LLM call or image. The full extractPumpReading requires API keys and a
 * real photo, so it's not testable in CI — the cross-check logic is the
 * load-bearing business rule that this slice ships.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { crossCheckPumpReading } from '../services/ocr.service';

describe('M12.3 — crossCheckPumpReading', () => {
  test('exact match → no mismatch', () => {
    const { mismatch, computedTotal } = crossCheckPumpReading(50, 25000, 1_250_000);
    assert.equal(mismatch, false);
    assert.equal(computedTotal, 1_250_000);
  });

  test('small rounding deviation (< 5%) → no mismatch', () => {
    // 50.5 litres × 25000 = 1,262,500 but pump shows 1,262,000 (rounding).
    // Deviation = 500 / 1,262,000 = 0.04% → within tolerance.
    const { mismatch, computedTotal } = crossCheckPumpReading(50.5, 25000, 1_262_000);
    assert.equal(mismatch, false);
    assert.equal(computedTotal, 1_262_500);
  });

  test('large deviation (> 5%) → mismatch flagged', () => {
    // 50 × 25000 = 1,250,000 but pump shows 1,000,000 — 20% off.
    const { mismatch, computedTotal } = crossCheckPumpReading(50, 25000, 1_000_000);
    assert.equal(mismatch, true);
    assert.equal(computedTotal, 1_250_000);
  });

  test('any null value → no mismatch, computedTotal null', () => {
    const r1 = crossCheckPumpReading(null, 25000, 1_250_000);
    assert.equal(r1.mismatch, false);
    assert.equal(r1.computedTotal, null);

    const r2 = crossCheckPumpReading(50, null, 1_250_000);
    assert.equal(r2.mismatch, false);
    assert.equal(r2.computedTotal, null);

    const r3 = crossCheckPumpReading(50, 25000, null);
    assert.equal(r3.mismatch, false);
    assert.equal(r3.computedTotal, null);
  });

  test('total = 0 → no mismatch (avoid division by zero)', () => {
    const { mismatch, computedTotal } = crossCheckPumpReading(50, 25000, 0);
    assert.equal(mismatch, false);
    assert.equal(computedTotal, null);
  });

  test('boundary: exactly 5% deviation → mismatch (strictly greater)', () => {
    // 5% of 1,000,000 = 50,000. computed = 1,050,000. deviation = 5%.
    // The check is > 0.05 (strictly greater), so exactly 5% is NOT a mismatch.
    const { mismatch } = crossCheckPumpReading(42, 25000, 1_000_000);
    // 42 × 25000 = 1,050,000; deviation = |1,050,000 - 1,000,000| / 1,000,000 = 5%
    assert.equal(mismatch, false, 'exactly 5% is within tolerance');
  });

  test('boundary: 5.1% deviation → mismatch', () => {
    // computed = 1,051,000; deviation = 5.1%
    const { mismatch } = crossCheckPumpReading(42.04, 25000, 1_000_000);
    // 42.04 × 25000 = 1,051,000
    assert.equal(mismatch, true, '5.1% exceeds tolerance');
  });
});
