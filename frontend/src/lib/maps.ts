import { api } from './api';

export interface PlaceSuggestion {
  placeId: string;
  description: string;
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
