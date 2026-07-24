import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePlate,
  parseBachKhoaDate,
  parseAspDate,
  isStale,
  deriveStatus,
  reviveDate,
  composeFleet,
  type ActiveTripRow,
  type LastKnownPosition,
} from '../services/gps.service';
import { parseBachKhoaResponse } from '@tingting/shared';
import type { BachKhoaVehicle } from '@tingting/shared';
import type { NormalizedGpsVehicle } from '../services/gps/providers/types';

const vehicle = (over: Partial<BachKhoaVehicle>): BachKhoaVehicle => ({
  Message: 'OK',
  NumberPlate: '15C-160.55',
  DeviceID: '602752',
  DriverName: null,
  DriverLicense: null,
  Date: '10:15:50 - 26/11/2018',
  Lt: 21.003803,
  Ln: 105.910861,
  Address: null,
  Angle: 0,
  CarStatus: null,
  Speed: 0,
  Acc: null,
  Oil: 0,
  ...over,
});

describe('normalizePlate', () => {
  test('strips separators + uppercases (dash/dot/space variance)', () => {
    assert.equal(normalizePlate('15C-160.55'), '15C16055');
    assert.equal(normalizePlate('15c.160.55'), '15C16055');
    assert.equal(normalizePlate(' 15C 160 55 '), '15C16055');
  });

  test('our DB format matches the provider documented format', () => {
    // Our trucks: "15C-136.31"; provider doc: "15C-160.55" → both normalize equal-shape.
    assert.equal(normalizePlate('15C-136.31').length, normalizePlate('15C-160.55').length);
  });

  test('nullish / empty → empty string', () => {
    assert.equal(normalizePlate(null), '');
    assert.equal(normalizePlate(undefined), '');
    assert.equal(normalizePlate(''), '');
  });
});

describe('parseBachKhoaDate', () => {
  test('parses "HH:mm:ss - dd/MM/yyyy" as Vietnam local (UTC+7)', () => {
    // 10:15:50 on 26/11/2018 in UTC+7 = 03:15:50Z same day.
    const d = parseBachKhoaDate('10:15:50 - 26/11/2018');
    assert.ok(d);
    assert.equal(d!.toISOString(), '2018-11-26T03:15:50.000Z');
  });

  test('null / undefined / malformed → null', () => {
    assert.equal(parseBachKhoaDate(null), null);
    assert.equal(parseBachKhoaDate(undefined), null);
    assert.equal(parseBachKhoaDate(''), null);
    assert.equal(parseBachKhoaDate('not a date'), null);
  });
});

describe('isStale', () => {
  test('null date → stale', () => {
    assert.equal(isStale(null), true);
  });

  test('fresh within 10min threshold', () => {
    assert.equal(isStale(new Date(Date.now() - 5 * 60_000)), false);
  });

  test('stale beyond 10min threshold', () => {
    assert.equal(isStale(new Date(Date.now() - 11 * 60_000)), true);
  });
});

describe('deriveStatus', () => {
  test('stale → offline regardless of speed', () => {
    assert.equal(deriveStatus(true, false, 60), 'offline');
  });

  test('lostSignal → offline', () => {
    assert.equal(deriveStatus(false, true, 0), 'offline');
  });

  test('speed > 0 → moving', () => {
    assert.equal(deriveStatus(false, false, 50), 'moving');
  });

  test('speed 0 → stopped', () => {
    assert.equal(deriveStatus(false, false, 0), 'stopped');
  });
});

describe('parseAspDate', () => {
  test('parses /Date(epoch)/ treating the epoch as Vietnam wall-clock (UTC+7) → true UTC', () => {
    // Bách Khoa's portal emits the device's Vietnam wall-clock baked into the
    // epoch as if it were UTC, so subtract 7h to recover the true instant —
    // mirroring parseBachKhoaDate. Rendered back in Asia/Ho_Chi_Minh that yields
    // the same wall-clock the device panel shows (no future-dated "Cập nhật").
    const d = parseAspDate('/Date(1782217250000)/');
    assert.ok(d);
    assert.equal(d!.getTime(), 1782217250000 - 7 * 60 * 60 * 1000);
  });

  test('null / malformed → null', () => {
    assert.equal(parseAspDate(null), null);
    assert.equal(parseAspDate('not a date'), null);
    assert.equal(parseAspDate(''), null);
  });
});

describe('reviveDate', () => {
  // Regression: getLiveFleet caches the provider payload in Redis as JSON, which
  // flattens `lastSeenAt: Date` to an ISO string. On a cache hit the value is a
  // string, so `isStale(date)` crashed at `date.getTime()` (HTTP 500 on
  // /api/trips/live-fleet). reviveDate restores the typed Date | null model.
  test('revives a JSON-round-tripped ISO string back to a Date', () => {
    const d = reviveDate('2018-11-26T03:15:50.000Z');
    assert.ok(d instanceof Date);
    assert.equal(d!.toISOString(), '2018-11-26T03:15:50.000Z');
  });

  test('passes a real Date through unchanged', () => {
    const original = new Date('2018-11-26T03:15:50.000Z');
    assert.equal(reviveDate(original), original);
  });

  test('null / undefined / empty / garbage → null', () => {
    assert.equal(reviveDate(null), null);
    assert.equal(reviveDate(undefined), null);
    assert.equal(reviveDate(''), null);
    assert.equal(reviveDate('not a date'), null);
  });

  test('isStale does not throw when fed a revived string (the original crash)', () => {
    const tenSecondsAgoIso = new Date(Date.now() - 10_000).toISOString();
    assert.equal(isStale(reviveDate(tenSecondsAgoIso)), false);
  });
});

describe('parseBachKhoaResponse (shared)', () => {
  test('array parsed; drops rows with no plate or no GPS fix', () => {
    const res = parseBachKhoaResponse([
      vehicle({ NumberPlate: '15C-160.55' }),                    // kept
      vehicle({ NumberPlate: '', Lt: 21, Ln: 105 }),             // dropped: no plate
      vehicle({ NumberPlate: '15C-139.82', Lt: 0, Ln: 0 }),      // dropped: no fix
    ]);
    assert.equal(res.length, 1);
    assert.equal(res[0].NumberPlate, '15C-160.55');
  });

  test('single error object (e.g. access denied) → []', () => {
    const res = parseBachKhoaResponse({
      Message: 'Không có quyền truy cập', NumberPlate: null, Lt: 0, Ln: 0,
    });
    assert.deepEqual(res, []);
  });

  test('non-array / null / undefined → []', () => {
    assert.deepEqual(parseBachKhoaResponse(null), []);
    assert.deepEqual(parseBachKhoaResponse(undefined), []);
    assert.deepEqual(parseBachKhoaResponse('a string'), []);
  });
});

describe('composeFleet', () => {
  const NOW = new Date('2026-06-23T12:00:00Z');

  const trip = (over: Partial<ActiveTripRow> = {}): ActiveTripRow => ({
    tripId: 1,
    tripCode: 'TT-1',
    truckId: 10,
    licensePlate: '15C-136.31',
    driverName: 'Nam',
    customerName: 'ACME',
    routeName: 'HN → HY',
    ...over,
  });

  const gps = (over: Partial<NormalizedGpsVehicle> = {}): NormalizedGpsVehicle => ({
    numberPlate: '15C-136.31',
    deviceId: '602752',
    driverName: 'Nam',
    lat: 21.0,
    lng: 105.8,
    speed: 0,
    angle: 0,
    address: 'Hà Nội',
    ignitionOn: true,
    fuel: 50,
    lastSeenAt: new Date('2026-06-23T11:59:30Z'),
    lostSignal: false,
    ...over,
  });

  const lastPos = (over: Partial<LastKnownPosition> = {}): LastKnownPosition => ({
    truckId: 10,
    deviceId: '602752',
    lat: 21.0,
    lng: 105.8,
    speed: 12,
    angle: 90,
    address: 'Phú Thụy',
    ignitionOn: true,
    fuel: 48,
    gpsDriverName: 'Nam',
    lastSeenAt: new Date('2026-06-23T11:00:00Z'),
    ...over,
  });

  test('live match is emitted with derived status + queued for persist', () => {
    const res = composeFleet({
      activeTrips: [trip()],
      providerVehicles: [gps()],
      lastKnown: new Map(),
      legsByTrip: new Map(),
      now: NOW,
    });
    assert.equal(res.vehicles.length, 1);
    assert.equal(res.vehicles[0].truckId, 10);
    assert.equal(res.vehicles[0].status, 'stopped'); // fresh fix, speed 0
    assert.equal(res.error, undefined);
    assert.equal(res.persist.length, 1);
    assert.equal(res.persist[0].truckId, 10);
    assert.equal(res.persist[0].lat, 21.0);
  });

  test('whole-provider failure falls back to last-known offline (no error)', () => {
    const res = composeFleet({
      activeTrips: [trip()],
      providerVehicles: null,
      providerError: 'GPS provider not configured',
      lastKnown: new Map([[10, lastPos()]]),
      legsByTrip: new Map(),
      now: NOW,
    });
    assert.equal(res.vehicles.length, 1);
    assert.equal(res.vehicles[0].status, 'offline');
    assert.equal(res.vehicles[0].stale, true);
    assert.equal(res.vehicles[0].address, 'Phú Thụy');
    assert.equal(res.error, undefined); // map stays populated → no amber banner
    assert.equal(res.persist.length, 0); // fallback never persists
  });

  test('partial provider response fills the missing truck from last-known', () => {
    const trips = [
      trip({ truckId: 10, licensePlate: '15C-136.31' }),
      trip({ tripId: 2, tripCode: 'TT-2', truckId: 20, licensePlate: '15C-139.82' }),
    ];
    const lastKnown = new Map<number, LastKnownPosition>([[20, lastPos({ truckId: 20 })]]);
    const res = composeFleet({
      activeTrips: trips,
      providerVehicles: [gps()], // only truck 10 reported live
      lastKnown,
      legsByTrip: new Map(),
      now: NOW,
    });
    assert.equal(res.vehicles.length, 2);
    const byTruck = new Map(res.vehicles.map((v) => [v.truckId, v]));
    assert.equal(byTruck.get(10)!.status, 'stopped'); // live
    assert.equal(byTruck.get(20)!.status, 'offline'); // fallback
    assert.equal(res.persist.length, 1); // only the live fix is persisted
    assert.equal(res.persist[0].truckId, 10);
  });

  test('provider down with no last-known for any active trip → error', () => {
    const res = composeFleet({
      activeTrips: [trip()],
      providerVehicles: null,
      providerError: 'GPS provider not configured',
      lastKnown: new Map(), // nothing to fall back to
      legsByTrip: new Map(),
      now: NOW,
    });
    assert.equal(res.vehicles.length, 0);
    assert.equal(res.error, 'GPS provider not configured');
  });

  test('no active trips + empty provider → no error (grey notice, not banner)', () => {
    const res = composeFleet({
      activeTrips: [],
      providerVehicles: [],
      lastKnown: new Map(),
      legsByTrip: new Map(),
      now: NOW,
    });
    assert.equal(res.vehicles.length, 0);
    assert.equal(res.error, undefined);
  });

  test('stale live report renders offline but is still persisted', () => {
    const staleFix = gps({ lastSeenAt: new Date('2026-06-23T11:00:00Z') }); // >10min old
    const res = composeFleet({
      activeTrips: [trip()],
      providerVehicles: [staleFix],
      lastKnown: new Map(),
      legsByTrip: new Map(),
      now: NOW,
    });
    assert.equal(res.vehicles.length, 1);
    assert.equal(res.vehicles[0].status, 'offline'); // stale → offline
    assert.equal(res.vehicles[0].stale, true);
    assert.equal(res.persist.length, 1); // live fix still persisted
  });
});
