import { ApiError } from './errors';
import { notifySessionExpired } from './session';
import { getToken, setToken as storeToken, clearToken as storeClearToken, invalidateTokenCache } from '../../design-system/hooks/useToken';

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

type RequestInitWithSkip = RequestInit & { expectedUpdatedAt?: string };
type MutationOptions = {
  expectedUpdatedAt?: string;
  headers?: Record<string, string>;
};

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Every client mutation carries a transaction identifier. Domain clients that
 * need retry/replay semantics may supply their own stable Idempotency-Key; the
 * transport only generates one when the caller did not provide it.
 */
function ensureMutationTransactionKey(
  method: string | undefined,
  headers: Record<string, string>,
): void {
  if (!method || !MUTATION_METHODS.has(method.toUpperCase())) return;
  const hasKey = Object.keys(headers).some(
    (name) => name.toLowerCase() === 'idempotency-key',
  );
  if (!hasKey) headers['Idempotency-Key'] = crypto.randomUUID();
}

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
  private readonly updatedAtByPath = new Map<string, string>();

  constructor() {
    // Eagerly hydrate the token cache from localStorage on first use so
    // subsequent `getToken()` calls are O(1) and don't re-read storage.
    getToken();
  }

  setToken(token: string) {
    this.updatedAtByPath.clear();
    storeToken(token);
  }

  clearToken() {
    this.updatedAtByPath.clear();
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
    } else if (
      options?.method
      && ['PUT', 'PATCH', 'DELETE'].includes(options.method.toUpperCase())
    ) {
      const remembered = this.updatedAtByPath.get(this.normalizePath(path));
      if (remembered) headers['If-Unmodified-Since'] = remembered;
    }
    ensureMutationTransactionKey(options?.method, headers);

    const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
    this.handleSessionExpiry(res, token);
    if (!res.ok) throw await ApiError.fromResponse(res);
    const result = (await res.json()) as T;
    this.rememberUpdatedAt(path, options?.method, result);
    return result;
  }

  private normalizePath(path: string): string {
    const normalized = path.split('?')[0].replace(/\/+$/, '');
    return normalized || '/';
  }

  private rememberUpdatedAt(path: string, method: string | undefined, result: unknown): void {
    const normalizedPath = this.normalizePath(path);
    const normalizedMethod = method?.toUpperCase() ?? 'GET';
    if (normalizedMethod === 'DELETE') {
      this.updatedAtByPath.delete(normalizedPath);
      return;
    }

    const rememberRow = (row: unknown, fallbackPath: string) => {
      if (!row || typeof row !== 'object') return;
      const record = row as Record<string, unknown>;
      if (typeof record.updatedAt !== 'string') return;
      const rowPath = typeof record.id === 'number'
        ? `${fallbackPath}/${record.id}`
        : fallbackPath;
      this.updatedAtByPath.set(this.normalizePath(rowPath), record.updatedAt);
    };

    if (result && typeof result === 'object' && Array.isArray((result as { items?: unknown }).items)) {
      for (const row of (result as { items: unknown[] }).items) {
        rememberRow(row, normalizedPath);
      }
      return;
    }
    rememberRow(result, normalizedPath.replace(/\/\d+$/, ''));
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
    opts?: MutationOptions,
  ) {
    return this.request<T>(path, {
      method: 'POST',
      body: JSON.stringify(body),
      ...opts,
    });
  }
  put<T>(path: string, body: unknown, opts?: MutationOptions) {
    return this.request<T>(path, {
      method: 'PUT',
      body: JSON.stringify(body),
      ...opts,
    });
  }
  patch<T>(path: string, body: unknown, opts?: MutationOptions) {
    return this.request<T>(path, {
      method: 'PATCH',
      body: JSON.stringify(body),
      ...opts,
    });
  }
  delete<T>(path: string, opts?: MutationOptions) {
    return this.request<T>(path, { method: 'DELETE', ...opts });
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
    ensureMutationTransactionKey('POST', headers);
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
    ensureMutationTransactionKey('POST', headers);
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
