import { getToken } from '../../design-system/hooks/useToken';

/**
 * Photo URLs are protected behind the JWT, but the `<img>` tag can't send
 * Authorization headers. We attach the token as a query string instead.
 *
 * Security note: putting the JWT in a URL leaks it into nginx access logs,
 * browser history, and Referer headers. This is a known limitation; the
 * long-term fix is server-side signed URLs or cookie-based auth. Keeping
 * the implementation in one place so a future migration is a one-file
 * change.
 *
 * The token is read via the centralized `useToken` cache rather than
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
 * Resolve a stored photo reference to an authenticated, browser-renderable
 * URL. Accepts either a bare storage key (e.g. `trips/154/container-…jpg`, as
 * returned by the trip detail / containers endpoints) or an already-formed
 * `/api/photos/…` URL (as returned by a fresh OCR upload). Bare keys are
 * encoded so the slashes survive as a single path segment that the wildcard
 * photo route decodes.
 */
export function photoSrc(value: string | null | undefined): string {
  if (!value) return '';
  const url = value.startsWith('/api/photos/') ? value : `/api/photos/${encodeURIComponent(value)}`;
  return getAuthenticatedPhotoUrl(url);
}
