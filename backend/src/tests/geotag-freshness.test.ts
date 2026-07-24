import { test } from 'node:test';
import assert from 'node:assert';
import { validateGpsFreshness, GPS_FRESHNESS_MAX_STALE_S, GPS_FRESHNESS_MAX_SKEW_S } from '../services/geotag.service';
import { ApiError } from '../errors';

/**
 * Pure freshness-gate tests (no DB). The ownership + upsert paths are exercised
 * end-to-end via the route integration test; this isolates the time-window math
 * ported from the payroll reference:
 *   - undefined / 0 / negative gpsAt  → allowed (no device fix)
 *   - age <= 300s                      → allowed
 *   - age  > 300s                      → 422 (stale)
 *   - future skew <= 60s               → allowed
 *   - future skew  > 60s               → 422 (clock mismatch)
 */
const NOW = 1_700_000_000_000; // fixed epoch-ms so assertions are deterministic

function assertRejects(gpsAt: number | undefined, expected: RegExp) {
  assert.throws(
    () => validateGpsFreshness(gpsAt, NOW),
    (err: unknown) => err instanceof ApiError && err.statusCode === 422 && expected.test(err.message),
  );
}

test('allows undefined / zero / negative gpsAt (no device fix)', () => {
  assert.doesNotThrow(() => validateGpsFreshness(undefined, NOW));
  assert.doesNotThrow(() => validateGpsFreshness(0, NOW));
  assert.doesNotThrow(() => validateGpsFreshness(-1, NOW));
});

test('allows a fix at the max-stale boundary', () => {
  const boundary = NOW - GPS_FRESHNESS_MAX_STALE_S * 1000;
  assert.doesNotThrow(() => validateGpsFreshness(boundary, NOW));
});

test('rejects a fix older than the stale window', () => {
  const tooOld = NOW - (GPS_FRESHNESS_MAX_STALE_S + 1) * 1000;
  assertRejects(tooOld, /cũ/i);
});

test('allows a fix slightly in the future (clock skew tolerance)', () => {
  const withinSkew = NOW + GPS_FRESHNESS_MAX_SKEW_S * 1000;
  assert.doesNotThrow(() => validateGpsFreshness(withinSkew, NOW));
});

test('rejects a fix too far in the future (clock mismatch)', () => {
  const tooFuture = NOW + (GPS_FRESHNESS_MAX_SKEW_S + 1) * 1000;
  assertRejects(tooFuture, /không khớp/i);
});
