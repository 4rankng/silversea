/**
 * SIL-664 — the `/driver/me/two-orders` view is date-keyed.
 *
 * Owner ruling 03/11: `?date=X` lọc theo ngày là BẮT BUỘC. Before this fix
 * the route handler dropped the query param on the floor
 * (`getDriverTwoOrdersView(driver.id)`), so every `?date` returned the same
 * view — and the pair-membership lookup read the driver's latest ACTIVE pair
 * across ALL days, mislabeling another day's pair with today's date.
 *
 * Two laws are unit-pinned here (backend tests are unit-only — no DB/HTTP):
 *
 * 1. `parseDriverTwoOrdersDateParam` — absent/empty → undefined (service
 *    default stays today); a strict YYYY-MM-DD calendar date passes through;
 *    anything else (wrong shape, impossible calendar day, array value) is a
 *    400-grade DriverTwoOrdersDateParamError.
 * 2. The endpoint wiring (static source scan, filesystem-only): the route
 *    passes `req.query.date` through the parser into the service, and the
 *    service keys every read on the resolved day — so the param can never be
 *    silently dropped again.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  DriverTwoOrdersDateParamError,
  parseDriverTwoOrdersDateParam,
} from '../../services/driver-two-orders-date';

const routeSource = readFileSync(fileURLToPath(new URL('../../routes/driver.ts', import.meta.url)), 'utf8');
const serviceSource = readFileSync(fileURLToPath(new URL('../../services/driver.service.ts', import.meta.url)), 'utf8');

describe('SIL-664 parseDriverTwoOrdersDateParam', () => {
  it('absent / null / empty → undefined (service defaults to today)', () => {
    assert.equal(parseDriverTwoOrdersDateParam(undefined), undefined);
    assert.equal(parseDriverTwoOrdersDateParam(null), undefined);
    assert.equal(parseDriverTwoOrdersDateParam(''), undefined);
  });

  it('a valid YYYY-MM-DD calendar date passes through unchanged', () => {
    assert.equal(parseDriverTwoOrdersDateParam('2026-11-04'), '2026-11-04');
    assert.equal(parseDriverTwoOrdersDateParam('2024-02-29'), '2024-02-29');
  });

  it('non-ISO shapes are rejected with a 400-grade error', () => {
    for (const bad of ['05-11-2026', '2026/11/04', '2026-11-04T00:00:00Z', '20261104', 'next-tuesday']) {
      assert.throws(() => parseDriverTwoOrdersDateParam(bad), DriverTwoOrdersDateParamError, bad);
    }
  });

  it('impossible calendar days are rejected (no Date rollover)', () => {
    for (const bad of ['2026-02-30', '2026-13-01', '2026-11-32', '2025-02-29']) {
      assert.throws(() => parseDriverTwoOrdersDateParam(bad), DriverTwoOrdersDateParamError, bad);
    }
  });

  it('non-string query values (array/object from the query parser) are rejected', () => {
    assert.throws(() => parseDriverTwoOrdersDateParam(['2026-11-04']), DriverTwoOrdersDateParamError);
    assert.throws(() => parseDriverTwoOrdersDateParam({}), DriverTwoOrdersDateParamError);
    assert.throws(() => parseDriverTwoOrdersDateParam(20261104), DriverTwoOrdersDateParamError);
  });

  it('the error carries HTTP status 400 for the shared error handler', () => {
    try {
      parseDriverTwoOrdersDateParam('nope');
      assert.fail('expected DriverTwoOrdersDateParamError');
    } catch (err) {
      assert.ok(err instanceof DriverTwoOrdersDateParamError);
      assert.equal((err as DriverTwoOrdersDateParamError).status, 400);
    }
  });
});

describe('SIL-664 endpoint wiring (static source law)', () => {
  it('the route pipes req.query.date through the parser into the service', () => {
    assert.match(
      routeSource,
      /getDriverTwoOrdersView\(driver\.id,\s*parseDriverTwoOrdersDateParam\(req\.query\.date\)\)/,
      'route must forward ?date — the original defect was the param being dropped here',
    );
  });

  it('the service keys the view on the resolved day (param ?? today), never a bare today', () => {
    assert.match(serviceSource, /const day = date \?\? today;/);
    assert.match(serviceSource, /eq\(s\.trips\.departureDate, day\)/, 'pair-membership lookup must be day-scoped');
    assert.match(serviceSource, /eq\(s\.tripsComposite\.departureDate, day\)/, 'trip reads must be day-scoped');
    assert.match(serviceSource, /date: day/, 'the response must echo the selected day');
  });
});
