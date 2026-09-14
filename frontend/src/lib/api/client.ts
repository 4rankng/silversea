import { ApiError } from './errors';
import { notifySessionExpired } from './session';
import { getToken, setToken as storeToken, clearToken as storeClearToken, invalidateTokenCache } from '../token';

type MutationOptions = {
  expectedUpdatedAt?: string;
  headers?: Record<string, string>;
  idempotencyKey?: string;
  retryFingerprint?: string;
};
const API_BASE = import.meta.env.VITE_API_BASE || '/api';

type RequestInitWithSkip = RequestInit & MutationOptions;
type UploadOptions = MutationOptions;

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const RETRYABLE_COMMAND_KEY_TTL_MS = 5 * 60 * 1000;

type GeneratedCommandKey = {
  fingerprint: string;
  key: string;
};

export function fileCommandFingerprint(file: File): string {
  return [
    file.name,
    file.size,
    file.type,
    file.lastModified,
  ].join(':');
}

/**
 * Every client mutation carries a transaction identifier. Domain clients that
 * need retry/replay semantics may supply their own stable Idempotency-Key; the
 * transport only generates one when the caller did not provide it.
 */
function hasIdempotencyKey(headers: Record<string, string>): boolean {
  return Object.keys(headers).some(
    (name) => name.toLowerCase() === 'idempotency-key',
  );
}

function ensureMutationTransactionKey(
  method: string | undefined,
  headers: Record<string, string>,
  generatedKey?: string,
): void {
  if (!method || !MUTATION_METHODS.has(method.toUpperCase())) return;
  if (!hasIdempotencyKey(headers)) {
    headers['Idempotency-Key'] = generatedKey ?? crypto.randomUUID();
  }
}

/**
 * Thin wrapper around `fetch` for the project's REST API. Knows nothing
 * about domain shapes, Zod, or Vietnamese — see `./errors.ts` for error
 * translation. Endpoints are constructed in `api/*Client.ts` so this stays
 * purely transport-level.
 *
 * Token storage is delegated to `lib/token` so all auth
 * state flows through a single source of truth.
 */
class ApiClient {
  private readonly updatedAtByPath = new Map<string, string>();
  private readonly retryableCommandKeys = new Map<string, {
    activeRequests: number;
    key: string;
    expiresAt: number;
  }>();

  constructor() {
    // Eagerly hydrate the token cache from localStorage on first use so
    // subsequent `getToken()` calls are O(1) and don't re-read storage.
    getToken();
  }

  setToken(token: string) {
    this.updatedAtByPath.clear();
    this.retryableCommandKeys.clear();
    storeToken(token);
  }

  clearToken() {
    this.updatedAtByPath.clear();
    this.retryableCommandKeys.clear();
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
    if (options?.idempotencyKey && !hasIdempotencyKey(headers)) {
      headers['Idempotency-Key'] = options.idempotencyKey;
    }
    if (options?.expectedUpdatedAt) {
      headers['If-Unmodified-Since'] = options.expectedUpdatedAt;
    } else if (
      options?.method
      && ['PUT', 'PATCH', 'DELETE'].includes(options.method.toUpperCase())
    ) {
      const remembered = this.updatedAtByPath.get(this.normalizePath(path));
      if (remembered) headers['If-Unmodified-Since'] = remembered;
    }
    const generatedCommandKey = this.prepareMutationTransactionKey(path, options, headers);
    ensureMutationTransactionKey(options?.method, headers, generatedCommandKey?.key);

    let res: Response;
    try {
      res = await fetch(`${API_BASE}${path}`, { ...options, headers });
    } catch (error) {
      if (generatedCommandKey) {
        this.retainMutationTransactionKeyForRetry(generatedCommandKey);
      }
      throw error;
    }
    this.handleSessionExpiry(res, token);
    if (!res.ok) {
      // Non-server HTTP errors still mean the server processed the request;
      // release the key so it doesn't block future mutations.
      if (generatedCommandKey) {
        this.releaseMutationTransactionKey(generatedCommandKey);
      }
      throw await ApiError.fromResponse(res);
    }
    let result: T;
    try {
      result = (await res.json()) as T;
    } catch (error) {
      // Malformed JSON — retain the key so a retry can reuse it.
      if (generatedCommandKey) {
        this.retainMutationTransactionKeyForRetry(generatedCommandKey);
      }
      throw error;
    }
    // Release the command key only after the response is fully parsed —
    // a JSON parse failure before this point keeps the key retryable.
    if (generatedCommandKey) {
      this.releaseMutationTransactionKey(generatedCommandKey);
    }
    this.rememberUpdatedAt(path, options?.method, result);
    return result;
  }

  private normalizePath(path: string): string {
    const normalized = path.split('?')[0].replace(/\/+$/, '');
    return normalized || '/';
  }

  private prepareMutationTransactionKey(
    path: string,
    options: RequestInitWithSkip | undefined,
    headers: Record<string, string>,
  ): GeneratedCommandKey | null {
    const method = options?.method?.toUpperCase();
    if (!method || !MUTATION_METHODS.has(method) || hasIdempotencyKey(headers)) {
      return null;
    }

    const explicitFingerprint = options?.retryFingerprint?.trim();
    if (!explicitFingerprint && options?.body !== undefined && typeof options.body !== 'string') {
      return null;
    }

    const fingerprint = explicitFingerprint
      ? `${method}:${this.normalizePath(path)}:${explicitFingerprint}`
      : `${method}:${this.normalizePath(path)}:${options?.body ?? ''}`;
    const now = Date.now();
    const existing = this.retryableCommandKeys.get(fingerprint);
    if (existing && existing.expiresAt > now) {
      existing.activeRequests += 1;
      return { fingerprint, key: existing.key };
    }

    const key = crypto.randomUUID();
    this.retryableCommandKeys.set(fingerprint, {
      activeRequests: 1,
      key,
      expiresAt: now + RETRYABLE_COMMAND_KEY_TTL_MS,
    });
    return { fingerprint, key };
  }

  private releaseMutationTransactionKey(command: GeneratedCommandKey): void {
    const current = this.retryableCommandKeys.get(command.fingerprint);
    if (current?.key !== command.key) return;
    current.activeRequests = Math.max(0, current.activeRequests - 1);
    if (current.activeRequests === 0) {
      this.retryableCommandKeys.delete(command.fingerprint);
    }
  }

  private retainMutationTransactionKeyForRetry(command: GeneratedCommandKey): void {
    const current = this.retryableCommandKeys.get(command.fingerprint);
    if (current?.key !== command.key) return;
    current.activeRequests = Math.max(0, current.activeRequests - 1);
  }

  private rememberUpdatedAt(path: string, method: string | undefined, result: unknown): void {
    const normalizedPath = this.normalizePath(path);
    const normalizedMethod = method?.toUpperCase() ?? 'GET';
    if (normalizedMethod === 'DELETE') {
      this.updatedAtByPath.delete(normalizedPath);
      return;
    }

    const rememberRow = (row: unknown, fallbackPath: string, includeIdInKey: boolean) => {
      if (!row || typeof row !== 'object') return;
      const record = row as Record<string, unknown>;
      if (typeof record.updatedAt !== 'string') return;
      // For list items we cache at the row path (`<base>/<id>`) so a follow-up
      // mutation on the same row hits the cache. For a single object we
      // cache at the request path itself — both the read and the subsequent
      // mutation hit the same path, so adding the id would create a key the
      // mutation never looks up.
      const rowPath = includeIdInKey && typeof record.id === 'number'
        ? `${fallbackPath}/${record.id}`
        : fallbackPath;
      this.updatedAtByPath.set(this.normalizePath(rowPath), record.updatedAt);
    };

    if (result && typeof result === 'object' && Array.isArray((result as { items?: unknown }).items)) {
      for (const row of (result as { items: unknown[] }).items) {
        rememberRow(row, normalizedPath, true);
      }
      return;
    }
    // Single object: use the request path directly (do NOT strip a trailing
    // id, and do NOT append one — the subsequent mutation uses the same path).
    rememberRow(result, normalizedPath, false);
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
  postForm<T>(path: string, body: FormData, opts?: MutationOptions) {
    return this.request<T>(path, {
      method: 'POST',
      body,
      ...opts,
    }, true);
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
  async upload(url: string, formData: FormData, opts?: UploadOptions): Promise<unknown> {
    return this.request<unknown>(
      url,
      { method: 'POST', body: formData, ...opts },
      true, // skip Content-Type — browser sets the multipart boundary
    );
  }
}

export const api = new ApiClient();
