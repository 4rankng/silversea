import { useEffect, useState } from 'react';
import { api } from './client';

/**
 * Resolve a stored photo reference to the API-client-relative photo path
 * (`/photos/…` — the client owns `/api`), or null when the value is empty or is
 * already a browser-renderable `blob:` preview. Accepts either a bare storage
 * key (e.g. `trips/154/container-….jpg`, as returned by the trip detail /
 * containers endpoints) or an already-formed `/api/photos/…` URL (as returned
 * by a fresh OCR upload). Bare keys are encoded so the slashes survive as a
 * single path segment that the wildcard photo route decodes.
 */
export function photoRoutePath(value: string | null | undefined): string | null {
  const reference = value?.trim();
  if (!reference || reference.startsWith('blob:')) return null;
  if (reference.startsWith('/api/photos/')) return reference.slice('/api'.length);
  return reference.startsWith('/photos/') ? reference : `/photos/${encodeURIComponent(reference)}`;
}

/**
 * Load ONE protected photo with the Authorization header and hand back a
 * `blob:` URL the DOM can render (DRV-DET-08: a JWT must never ride in a query
 * string, where browser history, Referer headers and proxy logs capture it —
 * so this is the only way an `<img>` reaches a protected photo).
 *
 * - A `blob:` input (a file the caller just picked) passes through untouched:
 *   it is already a local object URL.
 * - A denied or failed read resolves to '' — a caller renders no image instead
 *   of the raw protected URL, so a denied read is never presented as a
 *   successful one.
 *
 * REVOKE CONTRACT: when the returned value differs from the input, this
 * function created it and the CALLER owns it — it must call
 * `URL.revokeObjectURL` once the element stops rendering it. When the returned
 * value is the input unchanged, the object URL belongs to whoever created the
 * preview and must NOT be revoked here.
 */
export async function loadAuthedPhotoObjectUrl(value: string | null | undefined): Promise<string> {
  if (!value) return '';
  if (value.startsWith('blob:')) return value;
  const path = photoRoutePath(value);
  if (!path) return '';
  try {
    return URL.createObjectURL(await api.getBlob(path));
  } catch {
    return '';
  }
}

/**
 * Load protected evidence photos with the Authorization header and hand back
 * `blob:` URLs the DOM can render.
 *
 * - `blob:` previews (a file the driver just picked) pass through untouched —
 *   they are already local object URLs and stay owned by their creator.
 * - Values that fail to load resolve to '' — the caller renders no image
 *   instead of the raw protected URL, so a denied read is never presented as a
 *   successful one.
 * - Every object URL this hook creates is revoked when the component unmounts
 *   or the values change.
 *
 * Takes the whole list so a caller can resolve a `map()` result without
 * calling a hook inside the loop; the returned array is index-aligned with the
 * input. `reloadKey` re-runs the fetch for the same values — the retry
 * affordance on a surface that offers one.
 */
export function useAuthedPhotoUrls(
  values: Array<string | null | undefined>,
  reloadKey = 0,
): string[] {
  // The array identity changes every render; its joined contents do not. The
  // signature is what the effect (and therefore the fetches) keys on.
  const signature = values.map((value) => value ?? '').join('\u0000');
  const [urls, setUrls] = useState<string[]>([]);

  useEffect(() => {
    const entries = signature.length === 0 ? [] : signature.split('\u0000');
    // Drop the previous batch first: an index-aligned array must never pair a
    // stale URL with a new value (a removed photo would shift the whole list).
    setUrls((prev) => (prev.length === 0 ? prev : []));
    let active = true;
    const createdUrls: string[] = [];
    void Promise.all(entries.map(async (value) => {
      const url = await loadAuthedPhotoObjectUrl(value);
      // Only URLs this effect created are revoked; a pending preview belongs to
      // its creator. Late arrivals (a fetch that lands after unmount) would
      // never be seen by the cleanup, so they are revoked here instead.
      if (url && url !== value) {
        if (active) createdUrls.push(url);
        else URL.revokeObjectURL(url);
      }
      return active ? url : '';
    })).then((next) => {
      if (active) setUrls(next);
    });
    return () => {
      active = false;
      for (const objectUrl of createdUrls) URL.revokeObjectURL(objectUrl);
    };
  }, [signature, reloadKey]);

  return urls;
}

/**
 * Single-value convenience over `useAuthedPhotoUrls` for a surface that
 * renders exactly one photo: `const src = useAuthedPhotoUrl(key)`. Same
 * failure semantics — `''` when the read is denied, pending or absent.
 */
export function useAuthedPhotoUrl(value: string | null | undefined): string {
  return useAuthedPhotoUrls([value])[0] ?? '';
}
