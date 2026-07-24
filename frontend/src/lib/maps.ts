import { api } from './api';

export interface PlaceSuggestion {
  placeId: string;
  description: string;
}

export interface RouteSuggestion {
  km: number;
  durationSeconds: number | null;
  polylinePath: string | null;
  summary: string;
}

export interface RouteResult {
  km: number | null;
  polylinePath: string | null;
  routes: RouteSuggestion[];
  selected: RouteSuggestion | null;
}

// ── In-memory cache for autocomplete (50 entries, 5-min TTL) ─────────────

const suggestionCache = new Map<string, { data: PlaceSuggestion[]; ts: number }>();
const CACHE_MAX = 50;
const CACHE_TTL = 5 * 60 * 1000;

// ── Public API ────────────────────────────────────────────────────────────

export async function fetchPlaceSuggestions(input: string, sessionToken?: string): Promise<PlaceSuggestion[]> {
  if (!input.trim() || input.trim().length < 3) return [];

  const key = input.trim().toLowerCase();

  // Check cache
  const cached = suggestionCache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  try {
    let url = `/maps/autocomplete?q=${encodeURIComponent(input)}`;
    if (sessionToken) {
      url += `&sessiontoken=${encodeURIComponent(sessionToken)}`;
    }
    const data = await api.get<{ suggestions: PlaceSuggestion[] }>(url);
    const suggestions = data.suggestions ?? [];

    // Evict oldest if at capacity
    if (suggestionCache.size >= CACHE_MAX) {
      const oldest = suggestionCache.keys().next().value;
      if (oldest) suggestionCache.delete(oldest);
    }
    suggestionCache.set(key, { data: suggestions, ts: Date.now() });

    return suggestions;
  } catch {
    return [];
  }
}

export async function calculateRoute(origin: string, destination: string): Promise<RouteResult> {
  if (!origin || !destination || origin === destination) {
    return { km: null, polylinePath: null, routes: [], selected: null };
  }

  try {
    const data = await api.get<{
      km?: number | null;
      polylinePath?: string | null;
      routes?: RouteSuggestion[];
      selected?: RouteSuggestion | null;
    }>(
      `/maps/distance?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`
    );
    // New backend shape: { routes, selected } with km/polylinePath mirrored on `selected`
    // for back-compat with single-route callers.
    const routes = Array.isArray(data.routes) ? data.routes : [];
    const selected = data.selected ?? null;
    return {
      km: data.km ?? selected?.km ?? null,
      polylinePath: data.polylinePath ?? selected?.polylinePath ?? null,
      routes,
      selected,
    };
  } catch {
    return { km: null, polylinePath: null, routes: [], selected: null };
  }
}


export function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0;
  const len = encoded.length;
  let lat = 0;
  let lng = 0;

  while (index < len) {
    let b;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lng += dlng;

    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}



