/**
 * Map4D place search — unit tests for the pure mapping + geocode-fallback
 * helpers. Network (text-search) and Redis (cacheGet) are not exercised here;
 * they're covered by lib/redis's own tests and the live endpoint. These tests
 * pin the row→suggestion shape (incl. dropping location-less rows) and the
 * geocode fallback's "stop at first hit, fall back over comma-parts" contract.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { mapToSuggestions, geocodeFromLookup, googleResultToPlace, type Map4dPlace } from '../services/map4d';

const row = (over: Partial<Map4dPlace>): Map4dPlace => ({
  id: 'x',
  name: 'name',
  address: 'address',
  location: { lat: 1, lng: 2 },
  ...over,
});

describe('map4d: mapToSuggestions', () => {
  test('maps rows with a coordinate to {placeId, description, lat, lng}', () => {
    const out = mapToSuggestions(
      [row({ id: '1', address: 'Phường Hạ Long, Tỉnh Quảng Ninh', location: { lat: 20.94, lng: 107.10 } })],
      8,
    );
    assert.deepEqual(out, [
      { placeId: '1', description: 'Phường Hạ Long, Tỉnh Quảng Ninh', lat: 20.94, lng: 107.10 },
    ]);
  });

  test('prefers address, falls back to name when address is absent', () => {
    const out = mapToSuggestions([row({ id: '2', address: undefined, name: 'Cảng Hải Phòng' })], 8);
    assert.equal(out[0].description, 'Cảng Hải Phòng');
  });

  test('drops rows missing a location', () => {
    const out = mapToSuggestions(
      [row({ id: 'has' }), row({ id: 'no-loc', location: undefined })],
      8,
    );
    assert.deepEqual(out.map((s) => s.placeId), ['has']);
  });

  test('drops rows with non-numeric lat/lng', () => {
    const out = mapToSuggestions(
      [row({ id: 'bad', location: { lat: NaN, lng: 2 } })],
      8,
    );
    assert.equal(out.length, 0);
  });

  test('respects the limit (slices before mapping)', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })];
    assert.equal(mapToSuggestions(rows, 2).length, 2);
    assert.equal(mapToSuggestions(rows, 8).length, 3);
  });

  test('empty input → empty output', () => {
    assert.deepEqual(mapToSuggestions([], 8), []);
  });
});

describe('map4d: googleResultToPlace (Google fallback normalization)', () => {
  test('maps formatted_address + geometry.location into the Map4dPlace shape', () => {
    const p = googleResultToPlace({
      place_id: 'ChIJ123',
      formatted_address: 'Vụ Yên, Yên Bái, Vietnam',
      geometry: { location: { lat: 21.5, lng: 104.6 } },
    });
    assert.deepEqual(p, {
      id: 'g:ChIJ123',
      name: 'Vụ Yên, Yên Bái, Vietnam',
      address: 'Vụ Yên, Yên Bái, Vietnam',
      location: { lat: 21.5, lng: 104.6 },
    });
  });

  test('normalized Google rows pass straight through mapToSuggestions', () => {
    const p = googleResultToPlace({
      place_id: 'X',
      formatted_address: 'Hà Nội, Vietnam',
      geometry: { location: { lat: 21.0, lng: 105.8 } },
    });
    const out = mapToSuggestions([p], 8);
    assert.equal(out.length, 1);
    assert.equal(out[0].placeId, 'g:X');
    assert.equal(out[0].description, 'Hà Nội, Vietnam');
  });
});

describe('map4d: geocodeFromLookup', () => {
  /** A lookup that records every text it is called with. */
  const recording = (table: Map4dPlace[][], calls: string[]) =>
    (text: string): Promise<Map4dPlace[]> => {
      calls.push(text);
      return Promise.resolve(table.shift() ?? []);
    };

  test('returns the full-name coordinate and stops (one lookup, no fallback)', async () => {
    const calls: string[] = [];
    const lookup = recording(
      [[row({ location: { lat: 21.0, lng: 105.8 } })]],
      calls,
    );
    const c = await geocodeFromLookup('Hà Nội', lookup);
    assert.deepEqual(c, [21.0, 105.8]);
    assert.deepEqual(calls, ['Hà Nội']); // full name hit → no comma-part probes
  });

  test('falls back to a trailing comma-substring when the full name misses', async () => {
    const calls: string[] = [];
    const lookup = recording(
      [[], [row({ location: { lat: 20.0, lng: 106.0 } })]], // full misses, tail hits
      calls,
    );
    const c = await geocodeFromLookup('Công ty ABC, Sông Thao, Phú Thọ', lookup);
    assert.deepEqual(c, [20.0, 106.0]);
    assert.equal(calls.length, 2);
    assert.equal(calls[0], 'Công ty ABC, Sông Thao, Phú Thọ');
    // first fallback drops only the leading company part
    assert.equal(calls[1], 'Sông Thao, Phú Thọ');
  });

  test('returns null when every substring misses', async () => {
    const calls: string[] = [];
    const lookup = recording([[], [], []], calls);
    const c = await geocodeFromLookup('A, B, C', lookup);
    assert.equal(c, null);
    assert.equal(calls.length, 3); // full + 2 trailing substrings
  });

  test('single token that misses → null with one lookup', async () => {
    const calls: string[] = [];
    const lookup = recording([[]], calls);
    const c = await geocodeFromLookup('Nowhere', lookup);
    assert.equal(c, null);
    assert.deepEqual(calls, ['Nowhere']);
  });

  test('first row without a location is treated as a miss', async () => {
    const calls: string[] = [];
    const lookup = recording(
      [[row({ location: undefined })], [row({ location: { lat: 9, lng: 9 } })]],
      calls,
    );
    const c = await geocodeFromLookup('Foo, Bar', lookup);
    assert.deepEqual(c, [9, 9]); // fell through to the comma-part
  });
});
