/**
 * Centralized access to the JWT stored in localStorage.
 *
 * The codebase previously read `localStorage.getItem('token')` from at least
 * three call sites (`useAuth`, `lib/api/photo.ts`, `lib/api/client.ts`). This
 * hook is now the only place that touches the storage key directly, which
 * makes a future migration to HttpOnly cookies or a refresh-token flow a
 * one-file change.
 *
 * Components that need a token for display only (e.g. `<img>` tags via the
 * `getAuthenticatedPhotoUrl` helper) should continue to call that helper,
 * which now goes through this hook's cached value instead of re-reading
 * localStorage on every URL construction.
 */
const STORAGE_KEY = 'token';

let cachedToken: string | null | undefined; // undefined = not yet read

function readToken(): string | null {
  if (cachedToken !== undefined) return cachedToken;
  try {
    cachedToken = localStorage.getItem(STORAGE_KEY);
  } catch {
    cachedToken = null;
  }
  return cachedToken;
}

function writeToken(next: string | null): void {
  cachedToken = next;
  try {
    if (next === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Storage may be unavailable (private mode, SSR). Fail silently — the
    // api client will simply omit the Authorization header.
  }
}

/** Read the current token (cached after first call). */
export function getToken(): string | null {
  return readToken();
}

/** Set or clear the token. Pass `null` to clear. */
export function setToken(token: string | null): void {
  writeToken(token);
}

/** Clear the token (alias for `setToken(null)`). */
export function clearToken(): void {
  setToken(null);
}

/** Drop the in-memory cache so the next `getToken()` re-reads localStorage. */
export function invalidateTokenCache(): void {
  cachedToken = undefined;
}

/** Clear only the token rejected by the server. Read shared storage afresh:
 * another tab may have signed in before its storage event reaches this tab. */
export function isCurrentToken(expected: string | null): boolean {
  let current = cachedToken;
  try { current = localStorage.getItem(STORAGE_KEY); } catch { /* In-memory fallback. */ }
  if (current === undefined) current = readToken();
  cachedToken = current;
  return current === expected;
}

export function clearTokenIfCurrent(expected: string | null): boolean {
  if (!isCurrentToken(expected)) return false;
  clearToken();
  return true;
}

/** Browser storage events come only from other documents. Re-read the
 * current value rather than trusting an event queued before a newer login. */
export function onStoredTokenChange(listener: (token: string | null) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handle = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    if (event.storageArea && event.storageArea !== localStorage) return;
    invalidateTokenCache();
    listener(getToken());
  };
  window.addEventListener('storage', handle);
  return () => window.removeEventListener('storage', handle);
}
