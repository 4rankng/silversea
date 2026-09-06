/**
 * Maps service — place autocomplete via Map4D, with a Google Maps Geocoding
 * fallback (see ./map4d). Extracted from routes/maps.ts.
 */
import { searchPlaces } from './map4d';
// TEMPORARY: expose the location-search diagnostic for the autocomplete ?debug=1 probe.
export { debugResolve } from './map4d';

// ── Types ──────────────────────────────────────────────────────────────────

export interface PlaceSuggestion {
  placeId: string;
  description: string;
  lat: number;
  lng: number;
}

// ── Places Autocomplete (Map4D) ───────────────────────────────────────────

export async function getPlaceAutocomplete(query: string, _sessionToken?: string): Promise<PlaceSuggestion[]> {
  return searchPlaces(query, 8);
}
