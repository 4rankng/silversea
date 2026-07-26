import { ApiError } from './errors';
import { notifySessionExpired } from './session';
import { getToken, setToken as storeToken, clearToken as storeClearToken, invalidateTokenCache } from '../../design-system/hooks/useToken';

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

type RequestInitWithSkip = RequestInit & { expectedUpdatedAt?: string };

/**
 * Thin wrapper around `fetch` for the project's REST API. Knows nothing
 * about domain shapes, Zod, or Vietnamese — see `./errors.ts` for error
 * translation. Endpoints are constructed in `api/*Client.ts` so this stays
 * purely transport-level.
 *
 * Token storage is delegated to `design-system/hooks/useToken` so all auth
 * state flows through a single source of truth.
 */
class ApiClient {
  constructor() {
    // Eagerly hydrate the token cache from localStorage on first use so
    // subsequent `getToken()` calls are O(1) and don't re-read storage.
    getToken();
  }

  setToken(token: string) {
    storeToken(token);
  }

  clearToken() {
    storeClearToken();
  }

  /** Drop the in-memory token cache. Useful on logout or tab-switching. */
  refreshTokenFromStorage() {
    invalidateTokenCache();
  }

  private async request<T>(
    path: string,
    options?: RequestInitWithSkip,
    skipContentType = false,
  ): Promise<T> {
    const token = getToken();
    const headers: Record<string, string> = {
      ...(skipContentType ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...((options?.headers as Record<string, string> | undefined) || {}),
    };
    if (options?.expectedUpdatedAt) {
      headers['If-Unmodified-Since'] = options.expectedUpdatedAt;
    }

    const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
    this.handleSessionExpiry(res, token);
    if (!res.ok) throw await ApiError.fromResponse(res);
    return (await res.json()) as T;
  }

  /**
   * A rejected token is an application-state transition, not a form error.
   * Clear it immediately and let AuthProvider swap the current route to the
   * login screen. Keep unauthenticated 401s (such as bad login credentials)
   * as ordinary request errors.
   */
  private handleSessionExpiry(res: Response, requestToken: string | null): void {
    if (res.status !== 401 || !requestToken) return;
    // Ignore a late 401 from an older request after the user has already
    // established a newer session.
    if (getToken() !== requestToken) return;
    storeClearToken();
    notifySessionExpired();
  }

  get<T>(path: string) {
    return this.request<T>(path);
  }
  post<T>(
    path: string,
    body: unknown,
    opts?: { expectedUpdatedAt?: string; headers?: Record<string, string> },
  ) {
    return this.request<T>(path, {
      method: 'POST',
      body: JSON.stringify(body),
      ...opts,
    });
  }
  put<T>(path: string, body: unknown, opts?: { expectedUpdatedAt?: string }) {
    return this.request<T>(path, {
      method: 'PUT',
      body: JSON.stringify(body),
      ...opts,
    });
  }
  patch<T>(path: string, body: unknown) {
    return this.request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
  }
  delete<T>(path: string) {
    return this.request<T>(path, { method: 'DELETE' });
  }

  /** Fetch a text response (e.g. HTML) with auth headers via GET. */
  async getForText(url: string): Promise<string> {
    const token = getToken();
    const headers: Record<string, string> = {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    const res = await fetch(`${API_BASE}${url}`, { headers });
    this.handleSessionExpiry(res, token);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ApiError(res.status, null, text || `Request failed: ${res.status}`);
    }
    return res.text();
  }

  /** Fetch a binary blob (PDF, XLSX, etc.) with auth headers. */
  async getBlob(url: string): Promise<Blob> {
    const token = getToken();
    const headers: Record<string, string> = {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    const res = await fetch(`${API_BASE}${url}`, { headers });
    this.handleSessionExpiry(res, token);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ApiError(res.status, null, text || `Request failed: ${res.status}`);
    }
    return res.blob();
  }

  /** POST JSON body and receive a binary blob response. */
  async postForBlob(url: string, body: unknown): Promise<Blob> {
    const token = getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    const res = await fetch(`${API_BASE}${url}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    this.handleSessionExpiry(res, token);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ApiError(res.status, null, text || `Request failed: ${res.status}`);
    }
    return res.blob();
  }

  /** POST JSON body and receive a text response (e.g. HTML). */
  async postForText(url: string, body: unknown): Promise<string> {
    const token = getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    const res = await fetch(`${API_BASE}${url}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    this.handleSessionExpiry(res, token);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ApiError(res.status, null, text || `Request failed: ${res.status}`);
    }
    return res.text();
  }

  /** Upload files with auth headers (multipart/form-data). */
  async upload(url: string, formData: FormData): Promise<unknown> {
    return this.request<unknown>(
      url,
      { method: 'POST', body: formData },
      true, // skip Content-Type — browser sets the multipart boundary
    );
  }
}

export const api = new ApiClient();
