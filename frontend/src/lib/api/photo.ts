import { useEffect, useState } from 'react';
import { getToken } from '../token';
import { api } from './client';

/**
 * Photo URLs are protected behind the JWT, but the `<img>` tag can't send
 * Authorization headers.
 *
 * DEPRECATED for new call sites — see `useAuthedPhotoUrls` below. This helper
 * attaches the token as a query string, which leaks it into nginx access logs,
 * browser history, Referer headers and proxy logs; DRV-DET-08 forbids that
 * shape for evidence photos. It stays only for the call sites that have not
 * been migrated yet and it must not be used by new code.
 *
 * The token is read via the centralized `lib/token` cache rather than
 * re-parsing `localStorage` on every URL construction.
 */
export function getAuthenticatedPhotoUrl(url: string | null | undefined): string {
  if (!url) return '';
  if (url.startsWith('/api/photos/') || url.includes('/api/photos/')) {
    const token = getToken();
    if (token) {
      const separator = url.includes('?') ? '&' : '?';
      return `${url}${separator}token=${encodeURIComponent(token)}`;
    }
  }
  return url;
}

/**
 * Resolve a stored photo reference to the authenticated photo route path the
 * API serves (`GET /api/photos/…`), or null when the value is empty or is
 * already a browser-renderable `blob:` preview. Accepts either a bare storage
 * key (e.g. `trips/154/container-….jpg`, as returned by the trip detail /
 * containers endpoints) or an already-formed `/api/photos/…` URL (as returned
 * by a fresh OCR upload). Bare keys are encoded so the slashes survive as a
 * single path segment that the wildcard photo route decodes.
 */
export function photoRoutePath(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith('blob:')) return null;
  return value.startsWith('/api/photos/') ? value : `/api/photos/${encodeURIComponent(value)}`;
}

/**
 * Resolve a stored photo reference to an authenticated, browser-renderable URL.
 *
 * Legacy synchronous form: it still returns a `?token=` URL. Prefer
 * `useAuthedPhotoUrls` (async blob fetch with the Authorization header), which
 * is what DRV-DET-08 requires for evidence photos.
 */
export function photoSrc(value: string | null | undefined): string {
  if (!value) return '';
  if (value.startsWith('blob:')) return value;
  return getAuthenticatedPhotoUrl(photoRoutePath(value) as string);
}

/**
 * Load protected evidence photos with the Authorization header and hand back
 * `blob:` URLs the DOM can render (DRV-DET-08: a JWT must never ride in a
 * query string, where browser history, Referer and proxy logs can capture it).
 *
 * - `blob:` previews (a file the driver just picked) pass through untouched —
 *   they are already local object URLs.
 * - Values that fail to load resolve to '' — the caller renders no image
 *   instead of the raw protected URL, so a denied read is never presented as a
 *   successful one.
 * - Every object URL this hook creates is revoked when the component unmounts
 *   or the values change.
 *
 * Takes the whole list so a caller can resolve a `map()` result without
 * calling a hook inside the loop; the returned array is index-aligned with the
 * input.
 */
export function useAuthedPhotoUrls(values: Array<string | null | undefined>): string[] {
  // The array identity changes every render; its joined contents do not. The
  // signature is what the effect (and therefore the fetches) keys on.
  const signature = values.map((value) => value ?? '').join('\u0000');
  const [urls, setUrls] = useState<string[]>([]);

  useEffect(() => {
    const entries = signature.length === 0 ? [] : signature.split('\u0000');
    let active = true;
    const createdUrls: string[] = [];
    void Promise.all(entries.map(async (value) => {
      if (value.startsWith('blob:')) return value;
      const path = photoRoutePath(value);
      if (!path) return '';
      try {
        const blob = await api.getBlob(path);
        if (!active) return '';
        const objectUrl = URL.createObjectURL(blob);
        createdUrls.push(objectUrl);
        return objectUrl;
      } catch {
        return '';
      }
    })).then((next) => {
      if (active) setUrls(next);
    });
    return () => {
      active = false;
      for (const objectUrl of createdUrls) URL.revokeObjectURL(objectUrl);
    };
  }, [signature]);

  return urls;
}
