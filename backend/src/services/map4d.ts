/**
 * Place search via Map4D (api.map4d.vn) — the map/search provider the Bách Khoa
 * (dvbk.vn) portal embeds — with a Google Maps Geocoding fallback. This is our
 * location-search source for (a) trip-creation place autocomplete and (b)
 * resolving leg place-names to coordinates for GPS-trail slicing. It replaced
 * OpenStreetMap/Nominatim.
 *
 * ── Map4D key (Bách Khoa's) ────────────────────────────────────────────────
 * The key (config.map4dApiKey) is Bách Khoa's own, baked into the dvbk.vn
 * portal. It does NOT require a Bách Khoa login, but Map4D restricts it to the
 * dvbk.vn referrer — so a bare server-side call returns nothing. We therefore
 * send the request "via bach khoa web": browser-like User-Agent + Referer/
 * Origin https://dvbk.vn. That makes Map4D accept the call as if from the
 * portal. (Reliability note: Bách Khoa can rotate this key; see fallback.)
 *
 * ── Google Maps fallback ───────────────────────────────────────────────────
 * If Map4D yields nothing (referral block, key rotated, or genuine no-match),
 * we fall back to the Google Maps Geocoding API (config.googleMapsApiKey) so
 * autocomplete/geocoding always returns a result when one exists. Gemini is an
 * LLM, not a geocoder, so Google Maps Geocoding is the correct fallback.
 *
 * ── Caching ────────────────────────────────────────────────────────────────
 * Every lookup is fronted by the shared Redis `cacheGet` with a ~3-month TTL —
 * place geography barely changes, and the final result (Map4D OR Google) is
 * cached under one key per query, so repeats never re-hit either network. The
 * in-flight dedup itself is provided by lib/redis (covered by its own tests).
 *
 * ── Reliability ────────────────────────────────────────────────────────────
 * No 1 req/s throttle (keyed commercial endpoints, not Nominatim's policy). Any
 * failure (missing keys, non-2xx, network) degrades to []/null — never throws.
 *
 * Pure helpers (mapToSuggestions, geocodeFromLookup, googleResultToPlace) are
 * exported so the mapping + fallback logic is unit-testable without network.
 */
import { config } from '../config';
import { cacheGet } from '../lib/redis';

/** ~3 months (90 days) in seconds. Place data is effectively static. */
const THREE_MONTHS_TTL_SECONDS = 60 * 60 * 24 * 90;

/** 5 minutes in seconds for empty/null results so we don't cache configuration/network failures long-term. */
const EMPTY_CACHE_TTL_SECONDS = 300;

/** Headers that present our Map4D call as coming from the Bách Khoa portal. */
const BACHKHOA_BROWSER_HEADERS: Record<string, string> = {
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
  Referer: 'https://dvbk.vn/',
  Origin: 'https://dvbk.vn',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

export interface Map4dLocation {
  lat: number;
  lng: number;
}

export interface Map4dPlace {
  id: string;
  name: string;
  address?: string;
  location?: Map4dLocation;
  types?: string[];
}

interface Map4dResponse {
  code: string;
  result?: Map4dPlace[];
}

export interface Map4dSuggestion {
  placeId: string;
  description: string;
  lat: number;
  lng: number;
}

/** A single Google Maps Geocoding result (only the fields we use). */
export interface GoogleGeocodeResult {
  place_id: string;
  formatted_address: string;
  geometry: { location: Map4dLocation };
}

/** Pull the coordinate off a result row, validating both fields are finite. */
function coordOf(r: Map4dPlace | undefined): [number, number] | null {
  const loc = r?.location;
  if (!loc) return null;
  const { lat, lng } = loc;
  // Number.isFinite rejects NaN / Infinity (typeof NaN === 'number' would slip past).
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return [lat, lng];
}

/**
 * Map raw Map4D rows → autocomplete suggestions: drop rows without a usable
 * coordinate, prefer `address` over `name` for the description, cap to `limit`.
 * Pure — no network, no cache. Exposed for unit testing.
 */
export function mapToSuggestions(rows: Map4dPlace[], limit: number): Map4dSuggestion[] {
  return rows
    .filter((r) => coordOf(r) !== null)
    .slice(0, limit)
    .map((r) => ({
      placeId: r.id,
      description: r.address || r.name,
      lat: r.location!.lat,
      lng: r.location!.lng,
    }));
}

/**
 * Normalize a Google Maps Geocoding result into our Map4dPlace shape so the
 * Map4D and Google result sets flow through one mapping path. Pure — exposed
 * for unit testing.
 */
export function googleResultToPlace(g: GoogleGeocodeResult): Map4dPlace {
  return {
    id: `g:${g.place_id}`,
    name: g.formatted_address,
    address: g.formatted_address,
    location: { lat: g.geometry.location.lat, lng: g.geometry.location.lng },
  };
}

/**
 * Resolve a place-name to [lat, lng] via an injected lookup. Tries the full
 * name first, then progressively shorter trailing comma-substrings — handles
 * verbose entries like "Công Ty TNHH Giấy Việt Trì, Sông Thao, Phú Thọ" by
 * falling back to the province/city tail when the full string won't match.
 * Stops at the first hit, so a matching full name costs exactly one lookup.
 * Pure given `lookup` — exposed for unit testing.
 */
export function geocodeFromLookup(
  place: string,
  lookup: (text: string) => Promise<Map4dPlace[]>,
): Promise<[number, number] | null> {
  return (async () => {
    const top = (await lookup(place))[0];
    const c = coordOf(top);
    if (c) return c;
    const parts = place.split(',').map((s) => s.trim()).filter(Boolean);
    for (let i = 1; i < parts.length; i++) {
      const hit = (await lookup(parts.slice(i).join(', ')))[0];
      const cc = coordOf(hit);
      if (cc) return cc;
    }
    return null;
  })();
}

/**
 * One uncached Google Maps Geocoding call (the fallback). Returns results
 * (empty on any failure / when the key is unset). Scoped to Vietnam.
 */
async function googleGeocodeOnce(text: string): Promise<GoogleGeocodeResult[]> {
  if (!config.googleMapsApiKey) return [];
  const url =
    `https://maps.googleapis.com/maps/api/geocode/json` +
    `?address=${encodeURIComponent(text)}` +
    `&components=country:vn&language=vi` +
    `&key=${encodeURIComponent(config.googleMapsApiKey)}`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return [];
    const body = (await res.json()) as { results?: GoogleGeocodeResult[] };
    return Array.isArray(body?.results) ? body.results : [];
  } catch {
    return [];
  }
}

/**
 * Resolve a query to Map4D rows, falling back to Google Maps Geocoding when
 * Map4D yields nothing. Google results are normalized to Map4dPlace so callers
 * (searchPlaces) treat both sources identically. Uncached — the Redis layer is
 * the only cache.
 */
async function resolvePlacesOnce(text: string): Promise<Map4dPlace[]> {
  // Map4D is bypassed entirely in favor of the more reliable Google Maps Geocoding API
  return (await googleGeocodeOnce(text)).map(googleResultToPlace);
}

/** Cached place autocomplete. Google Maps Geocoding. */
export async function searchPlaces(query: string, limit = 8): Promise<Map4dSuggestion[]> {
  const q = query.trim();
  if (!q) return [];
  const key = `map4d:place:search:${q.toLowerCase()}`;
  // Cache the full row set per query (limit applied after), so different limit
  // values share one entry.
  const rows = await cacheGet<Map4dPlace[]>(
    key,
    (res) => (res.length > 0 ? THREE_MONTHS_TTL_SECONDS : EMPTY_CACHE_TTL_SECONDS),
    () => resolvePlacesOnce(q)
  );
  return mapToSuggestions(rows, limit);
}

/**
 * Resolve a place-name to [lat, lng] (cached, incl. null results). Google Maps Geocoding.
 * Mirrors the contract of the old osm.geocodePlace; powers GPS leg-coordinate resolution.
 */
export async function geocodePlace(place: string): Promise<[number, number] | null> {
  const p = place.trim();
  if (!p) return null;
  const key = `map4d:place:geocode:${p.toLowerCase()}`;
  return cacheGet<[number, number] | null>(
    key,
    (res) => (res !== null ? THREE_MONTHS_TTL_SECONDS : EMPTY_CACHE_TTL_SECONDS),
    async () => {
      // Map4D is bypassed entirely in favor of the more reliable Google Maps Geocoding API
      const g = (await googleGeocodeOnce(p))[0];
      return g ? [g.geometry.location.lat, g.geometry.location.lng] : null;
    }
  );
}

// ── TEMPORARY DIAGNOSTIC ───────────────────────────────────────────────────
// Surfaces each source's RAW http status + body head so we can see WHY a query
// comes back empty (referrer block, dead key, network, wrong shape). Exposed
// via the autocomplete route's ?debug=1. DELETE once location search is live.
interface SourceDiag {
  httpStatus: number | null;
  bodyHead: string;
  count: number;
  error: string;
}
export interface PlaceSearchDiag {
  query: string;
  keys: { map4d: boolean; google: boolean };
  map4dUrl: string;
  map4d: SourceDiag;
  google: SourceDiag;
}

function errStr(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function debugResolve(query: string): Promise<PlaceSearchDiag> {
  const q = query.trim();
  const diag: PlaceSearchDiag = {
    query: q,
    keys: { map4d: !!config.map4dApiKey, google: !!config.googleMapsApiKey },
    map4dUrl: '',
    map4d: { httpStatus: null, bodyHead: '', count: 0, error: '' },
    google: { httpStatus: null, bodyHead: '', count: 0, error: '' },
  };

  if (config.map4dApiKey) {
    const url =
      `${config.map4dApiUrl}/sdk/place/text-search` +
      `?key=${encodeURIComponent(config.map4dApiKey)}` +
      `&text=${encodeURIComponent(q)}&accuracy=0`;
    diag.map4dUrl = url.replace(config.map4dApiKey, '***');
    try {
      const res = await fetch(url, { headers: BACHKHOA_BROWSER_HEADERS });
      diag.map4d.httpStatus = res.status;
      const text = await res.text();
      diag.map4d.bodyHead = text.slice(0, 400);
      const parsed = JSON.parse(text) as Map4dResponse;
      diag.map4d.count = Array.isArray(parsed?.result) ? parsed.result.length : 0;
    } catch (e) {
      diag.map4d.error = errStr(e);
    }
  } else {
    diag.map4d.error = 'MAP4D_API_KEY not set';
  }

  if (config.googleMapsApiKey) {
    const url =
      `https://maps.googleapis.com/maps/api/geocode/json` +
      `?address=${encodeURIComponent(q)}&components=country:vn&language=vi` +
      `&key=${encodeURIComponent(config.googleMapsApiKey)}`;
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      diag.google.httpStatus = res.status;
      const text = await res.text();
      diag.google.bodyHead = text.slice(0, 400);
      const parsed = JSON.parse(text) as { results?: unknown[] };
      diag.google.count = Array.isArray(parsed?.results) ? parsed.results.length : 0;
    } catch (e) {
      diag.google.error = errStr(e);
    }
  } else {
    diag.google.error = 'GOOGLE_MAPS_API_KEY not set';
  }

  return diag;
}
