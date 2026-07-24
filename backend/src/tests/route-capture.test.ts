/**
 * Route capture — unit tests for the pure polyline/slicing helpers.
 * Covers encode↔decode round-trip, reversal, bidirectional resolution,
 * coord-based leg slicing, and spatial dedup.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  encodePolyline, decodePolyline, reverseEncodedPolyline, resolveRoute,
  sliceLegByPlaces, dedupPoints, tripWindowBoundsMs, filterToWindow, type LngLat, type RouteEntry,
} from '../services/gps/route-capture';

describe('route-capture: polyline codec', () => {
  test('encode ↔ decode round-trips within 1e-5', () => {
    const pts: LngLat[] = [[20.869, 106.715], [21.00123, 106.60045], [21.2, 106.1]];
    const dec = decodePolyline(encodePolyline(pts));
    assert.equal(dec.length, pts.length);
    for (let i = 0; i < pts.length; i++) {
      assert.ok(Math.abs(dec[i][0] - pts[i][0]) < 1e-5, `lat ${i}`);
      assert.ok(Math.abs(dec[i][1] - pts[i][1]) < 1e-5, `lng ${i}`);
    }
  });

  test('reverseEncodedPolyline reverses point order (same set)', () => {
    const pts: LngLat[] = [[20.8, 106.7], [21.0, 106.6], [21.2, 106.1]];
    const rev = decodePolyline(reverseEncodedPolyline(encodePolyline(pts)));
    assert.deepEqual(rev, [pts[2], pts[1], pts[0]]);
  });
});

describe('route-capture: resolveRoute (bidirectional)', () => {
  test('direct (origin,destination) match wins', () => {
    const m = new Map<string, RouteEntry>([['a|b', { polyline: 'AB', km: 10 }]]);
    assert.deepEqual(resolveRoute(m, 'A', 'B'), { polyline: 'AB', km: 10 });
  });

  test('falls back to reversed pair when direct absent', () => {
    const m = new Map<string, RouteEntry>([['b|a', { polyline: 'BA', km: 12 }]]);
    const r = resolveRoute(m, 'A', 'B'); // no a|b → use b|a reversed
    assert.ok(r);
    assert.equal(r!.km, 12);
    assert.equal(r!.polyline, reverseEncodedPolyline('BA'));
  });

  test('returns null when neither direction is present', () => {
    assert.equal(resolveRoute(new Map(), 'A', 'B'), null);
  });
});

describe('route-capture: sliceLegByPlaces (coord-based)', () => {
  const origin: LngLat = [20.869, 106.715];
  const dest: LngLat = [20.867, 106.062];

  test('slices origin → destination when the trail passes both', () => {
    const pts: LngLat[] = [origin, [20.9, 106.6], [21.0, 106.3], dest];
    const r = sliceLegByPlaces(pts, 0, origin, dest, 5);
    assert.ok(r);
    assert.deepEqual(r!.points[0], origin);
    assert.deepEqual(r!.points[r!.points.length - 1], dest);
    assert.equal(r!.endIdx, 3);
  });

  test('returns null when the truck never approached the origin (within tol)', () => {
    // Trail starts ~45 km from the origin → no point within 5 km.
    const pts: LngLat[] = [[21.0, 106.3], dest];
    assert.equal(sliceLegByPlaces(pts, 0, origin, dest, 5), null);
  });

  test('respects fromIdx (search starts mid-trail)', () => {
    const pts: LngLat[] = [origin, [20.9, 106.6], dest];
    // fromIdx=2 → origin not found after index 2 → null
    assert.equal(sliceLegByPlaces(pts, 2, origin, dest, 5), null);
  });
});

describe('route-capture: dedupPoints', () => {
  test('drops points within radiusM of the last kept point', () => {
    const pts: LngLat[] = [[20.869, 106.715], [20.86905, 106.71505], [20.95, 106.6]]; // middle ~8 m from pts[0]
    const d = dedupPoints(pts, 15);
    assert.equal(d.length, 2);
    assert.deepEqual(d[1], [20.95, 106.6]);
  });

  test('keeps everything when points are well separated', () => {
    const pts: LngLat[] = [[20.869, 106.715], [20.95, 106.6], [21.0, 106.3]];
    assert.equal(dedupPoints(pts, 15).length, 3);
  });
});

describe('route-capture: trip-scoped window (tripWindowBoundsMs + filterToWindow)', () => {
  test('lower bound = departure-day UTC+7 midnight minus 1h; upper = completedAt instant', () => {
    // Trip departed 2026-06-18 (VN). VN midnight = 2026-06-17T17:00:00Z; minus 1h.
    const { lowerMs, upperMs } = tripWindowBoundsMs('2026-06-18', '2026-06-19', new Date('2026-06-19T03:46:37Z'));
    assert.equal(lowerMs, Date.parse('2026-06-17T16:00:00Z'));
    assert.equal(upperMs, Date.parse('2026-06-19T03:46:37Z'));
  });

  test('null completedAt → upper bound = compDay VN end-of-day', () => {
    const { upperMs } = tripWindowBoundsMs('2026-06-18', '2026-06-19', null);
    assert.equal(upperMs, Date.parse('2026-06-19T23:59:59+07:00'));
  });

  test('filterToWindow drops outside-window points, keeps inside + null-time', () => {
    const pts = [
      { time: '2026-06-17T05:00:00Z' }, // before window (other trip) → drop
      { time: '2026-06-17T16:30:00Z' }, // >= lower bound (16:00Z) → keep
      { time: null },                    // null time → keep
      { time: '2026-06-18T20:00:00Z' }, // inside → keep
      { time: '2026-06-19T10:00:00Z' }, // after completion (03:46Z) → drop
    ];
    const lower = Date.parse('2026-06-17T16:00:00Z');
    const upper = Date.parse('2026-06-19T03:46:37Z');
    const out = filterToWindow(pts, p => (p.time ? Date.parse(p.time) : null), lower, upper);
    assert.equal(out.length, 3);
    assert.equal(out[0].time, '2026-06-17T16:30:00Z');
    assert.equal(out[1].time, null);
    assert.equal(out[2].time, '2026-06-18T20:00:00Z');
  });

  test('filterToWindow keeps everything when bounds are degenerate (upper <= lower)', () => {
    const pts = [{ time: '2000-01-01T00:00:00Z' }, { time: '2099-01-01T00:00:00Z' }];
    const out = filterToWindow(pts, p => (p.time ? Date.parse(p.time) : null), 100, 50);
    assert.equal(out.length, 2);
  });

  test('end-to-end: a multi-day truck trail narrows to the trip window', () => {
    // Trip 56 shape: dep 2026-06-18 (VN), completed 2026-06-19 03:46Z. The truck
    // also drove on 06-16/06-17 (other trips). lower bound = 2026-06-17T16:00:00Z
    // (departure-day VN-midnight minus 1h); upper = completion instant.
    const { lowerMs, upperMs } = tripWindowBoundsMs('2026-06-18', '2026-06-19', new Date('2026-06-19T03:46:37Z'));
    assert.equal(lowerMs, Date.parse('2026-06-17T16:00:00Z'));
    const trail = [
      '2026-06-16T18:00:00Z', // other trip → drop
      '2026-06-17T06:00:00Z', // other trip → drop
      '2026-06-18T01:00:00Z', // = 06-18 08:00 VN, trip start → keep
      '2026-06-18T20:00:00Z', // trip → keep
      '2026-06-19T02:00:00Z', // near completion → keep
      '2026-06-19T10:00:00Z', // after completion → drop
    ].map(time => ({ time }));
    const out = filterToWindow(trail, p => Date.parse(p.time!), lowerMs, upperMs);
    assert.equal(out.length, 3);
    assert.equal(out[0].time, '2026-06-18T01:00:00Z');
    assert.equal(out[2].time, '2026-06-19T02:00:00Z');
  });
});
