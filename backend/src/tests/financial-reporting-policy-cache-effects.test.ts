import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  REPORTING_CACHE_INVALIDATION_HORIZON_MONTHS,
  reportingCacheKeysFrom,
} from '../services/financial-reporting-policy.service';

describe('financial reporting policy cache invalidation', () => {
  test('invalidates every report family from the effective month onward', () => {
    const keys = reportingCacheKeysFrom('2026-08-01', 4, new Date('2026-08-03T12:00:00.000Z'));

    assert.ok(keys.includes('reports:dashboard'));
    assert.ok(keys.includes('reports:dashboard:executive'));
    assert.ok(keys.includes('reports:pnl:8:2026'));
    assert.ok(keys.includes('reports:pnl:9:2026'));
    assert.ok(keys.includes('reports:fuel-variance:10:2026'));
    assert.ok(keys.includes('reports:dashboard-widgets:11:2026'));
    assert.ok(keys.includes('reports:dashboard-widgets:current:'));
  });

  test('does not invalidate the current-month alias for future effective months', () => {
    const keys = reportingCacheKeysFrom('2026-09-01', 3, new Date('2026-08-03T12:00:00.000Z'));

    assert.equal(keys.includes('reports:dashboard-widgets:current:'), false);
    assert.ok(keys.includes('reports:pnl:9:2026'));
    assert.ok(keys.includes('reports:pnl:10:2026'));
    assert.ok(keys.includes('reports:pnl:11:2026'));
  });

  test('uses the configured bounded horizon by default', () => {
    const keys = reportingCacheKeysFrom('2026-08-01');
    const monthlyKeys = keys.filter((key) => key.startsWith('reports:pnl:'));

    assert.equal(monthlyKeys.length, REPORTING_CACHE_INVALIDATION_HORIZON_MONTHS);
    assert.ok(monthlyKeys.includes('reports:pnl:8:2026'));
    assert.ok(monthlyKeys.includes('reports:pnl:7:2029'));
  });
});
