import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { classifyLowMargin } from '../services/profitability.service';

describe('configurable low-margin classification', () => {
  test('alerts only below the configured threshold', () => {
    assert.deepEqual(
      classifyLowMargin({ revenue: 1_000_000, profit: 199_999, thresholdRatio: 0.2 }),
      { marginRatio: 0.199999, alertState: 'LOW_MARGIN' },
    );
    assert.deepEqual(
      classifyLowMargin({ revenue: 1_000_000, profit: 200_000, thresholdRatio: 0.2 }),
      { marginRatio: 0.2, alertState: 'OK' },
    );
    assert.deepEqual(
      classifyLowMargin({ revenue: 1_000_000, profit: 250_000, thresholdRatio: 0.2 }),
      { marginRatio: 0.25, alertState: 'OK' },
    );
  });

  test('keeps missing policy and non-comparable revenue explicit', () => {
    assert.deepEqual(
      classifyLowMargin({ revenue: 1_000_000, profit: 250_000, thresholdRatio: null }),
      { marginRatio: 0.25, alertState: 'UNCONFIGURED' },
    );
    assert.deepEqual(
      classifyLowMargin({ revenue: 0, profit: -50_000, thresholdRatio: 0.2 }),
      { marginRatio: null, alertState: 'NOT_COMPARABLE' },
    );
  });
});
