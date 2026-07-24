import { test } from 'node:test';
import assert from 'node:assert';
import { geotagSchema, GEOTAG_ENTITY_TYPES } from './geotag';

/**
 * Pure schema-validation tests for the geotag submit payload. No DB.
 * Covers bounds, entity whitelist, coerce, optionals, and the freshness
 * field type (the value-range freshness gate itself lives in the service).
 */
const validBase = {
  entityType: 'trip_photo' as const,
  entityId: 123,
  lat: 10.7864,
  lng: 106.6959,
  accuracy: 12.5,
  gpsAt: Date.now(),
};

test('accepts a minimal valid payload (optionals omitted)', () => {
  const parsed = geotagSchema.parse(validBase);
  assert.equal(parsed.entityType, 'trip_photo');
  assert.equal(parsed.source, 'phone'); // default
  assert.equal(parsed.accuracy, 12.5);
});

test('accepts all whitelisted entity types', () => {
  for (const t of GEOTAG_ENTITY_TYPES) {
    const parsed = geotagSchema.parse({ ...validBase, entityType: t });
    assert.equal(parsed.entityType, t);
  }
});

test('rejects an unknown entity type', () => {
  const r = geotagSchema.safeParse({ ...validBase, entityType: 'selfie' });
  assert.equal(r.success, false);
});

test('coerces entityId from string', () => {
  const parsed = geotagSchema.parse({ ...validBase, entityId: '456' });
  assert.equal(parsed.entityId, 456);
});

test('rejects entityId <= 0', () => {
  assert.equal(geotagSchema.safeParse({ ...validBase, entityId: 0 }).success, false);
  assert.equal(geotagSchema.safeParse({ ...validBase, entityId: -1 }).success, false);
});

test('rejects lat out of range', () => {
  assert.equal(geotagSchema.safeParse({ ...validBase, lat: 91 }).success, false);
  assert.equal(geotagSchema.safeParse({ ...validBase, lat: -91 }).success, false);
  // boundary values are valid
  assert.equal(geotagSchema.safeParse({ ...validBase, lat: 90 }).success, true);
  assert.equal(geotagSchema.safeParse({ ...validBase, lat: -90 }).success, true);
});

test('rejects lng out of range', () => {
  assert.equal(geotagSchema.safeParse({ ...validBase, lng: 181 }).success, false);
  assert.equal(geotagSchema.safeParse({ ...validBase, lng: -181 }).success, false);
});

test('accepts gpsAt omitted (manual / no-device-fix entry)', () => {
  const { gpsAt: _omit, ...withoutGpsAt } = validBase;
  void _omit;
  const parsed = geotagSchema.parse(withoutGpsAt);
  assert.equal(parsed.gpsAt, undefined);
});

test('accepts the diagnostic optional fields', () => {
  const parsed = geotagSchema.parse({
    ...validBase,
    sampleCount: 4,
    bestAccuracy: 8.2,
    elapsedMs: 3200,
    altitude: 11.0,
  });
  assert.equal(parsed.sampleCount, 4);
  assert.equal(parsed.bestAccuracy, 8.2);
  assert.equal(parsed.elapsedMs, 3200);
  assert.equal(parsed.altitude, 11.0);
});

test('accepts all whitelisted sources', () => {
  for (const src of ['phone', 'exif', 'manual'] as const) {
    const parsed = geotagSchema.parse({ ...validBase, source: src });
    assert.equal(parsed.source, src);
  }
});
