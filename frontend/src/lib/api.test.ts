import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';
import { onSessionExpired } from './api/session';
import { getToken } from './token';

describe('API session expiry', () => {
  beforeEach(() => {
    api.clearToken();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    api.clearToken();
  });

  it('clears a rejected token and notifies the authenticated shell on 401', async () => {
    api.setToken('expired-token');
    const listener = vi.fn();
    const unsubscribe = onSessionExpired(listener);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Token hết hạn hoặc không hợp lệ' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    ));

    await expect(api.post('/trips', { customerId: 1 })).rejects.toBeInstanceOf(ApiError);

    expect(getToken()).toBeNull();
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it('keeps an unauthenticated login 401 as a normal credential error', async () => {
    const listener = vi.fn();
    const unsubscribe = onSessionExpired(listener);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Sai thông tin đăng nhập' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    ));

    await expect(api.post('/auth/login', { identifier: 'x', password: 'y' }))
      .rejects.toBeInstanceOf(ApiError);

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('does not clear a newer session when an old request returns 401 late', async () => {
    api.setToken('old-token');
    const listener = vi.fn();
    const unsubscribe = onSessionExpired(listener);
    let resolveResponse!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveResponse = resolve;
      }),
    ));

    const oldRequest = api.get('/trips');
    api.setToken('new-token');
    resolveResponse(new Response(JSON.stringify({ error: 'Token hết hạn' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }));

    await expect(oldRequest).rejects.toBeInstanceOf(ApiError);
    expect(getToken()).toBe('new-token');
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});

describe('cross-tab API session isolation', () => {
  it('does not clear another tab’s newer token before the storage event arrives', async () => {
    api.setToken('tab-A-token');
    const listener = vi.fn();
    const unsubscribe = onSessionExpired(listener);
    let resolveResponse!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise<Response>((resolve) => { resolveResponse = resolve; })));
    const pending = api.get('/shipments');
    // Deliberately bypass api.setToken: another tab changes storage while
    // this JavaScript context still has A in its cached token.
    localStorage.setItem('token', 'tab-B-token');
    resolveResponse(new Response(JSON.stringify({ error: 'A revoked' }), { status: 401 }));
    try {
      await expect(pending).rejects.toBeInstanceOf(ApiError);
      expect(localStorage.getItem('token')).toBe('tab-B-token');
      expect(getToken()).toBe('tab-B-token');
      expect(listener).not.toHaveBeenCalled();
    } finally { unsubscribe(); api.clearToken(); }
  });
});

describe('cross-tab API actor caches and retries', () => {
  afterEach(() => { api.clearToken(); vi.restoreAllMocks(); });

  it('changes cache ownership before a queued storage event can clear the prior actor state', async () => {
    api.setToken('A');
    let resolve!: (r: Response) => void;
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockImplementationOnce(() => new Promise<Response>((r) => { resolve = r; }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.post('/trucks', { plate: 'QA' })).rejects.toMatchObject({ status: 503 });
    const lateRead = api.get('/trucks/42');
    localStorage.setItem('token', 'B');
    resolve(new Response('{}', { status: 200 }));
    await lateRead;
    await api.post('/trucks', { plate: 'QA' });
    const first = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    const next = fetchMock.mock.calls[2][1].headers as Record<string, string>;
    expect(next.Authorization).toBe('Bearer B');
    expect(next['Idempotency-Key']).not.toBe(first['Idempotency-Key']);
  });

  it('does not repopulate version hints from a late response for another actor', async () => {
    api.setToken('A');
    let resolve!: (r: Response) => void;
    const fetchMock = vi.fn().mockImplementationOnce(() => new Promise<Response>((r) => { resolve = r; }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const oldRead = api.get('/trucks/42');
    api.setToken('B');
    resolve(new Response(JSON.stringify({ id: 42, updatedAt: '2026-09-15T01:00:00Z' }), { status: 200 }));
    await oldRead;
    await api.put('/trucks/42', { name: 'B edit' });
    expect((fetchMock.mock.calls[1][1].headers as Record<string, string>)['If-Unmodified-Since']).toBeUndefined();
  });

  it.each(['before fetch', 'during fetch'])('does not replay A mutation under B when identity changes %s', async (phase) => {
    api.setToken('A');
    let resolve!: (r: Response) => void;
    const deferred = new Promise<Response>((r) => { resolve = r; });
    const missing = () => new Response(JSON.stringify({ code: 'VERSION_TOKEN_REQUIRED' }), { status: 428 });
    const fetchMock = phase === 'before fetch'
      ? vi.fn().mockReturnValueOnce(deferred).mockResolvedValue(new Response(JSON.stringify({ updatedAt: '2026-09-15T01:00:00Z' }), { status: 200 }))
      : vi.fn().mockResolvedValueOnce(missing()).mockReturnValueOnce(deferred).mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const pending = api.put('/trucks/42', { name: 'A edit' });
    const outcome = expect(pending).rejects.toMatchObject({ status: 428 });
    if (phase === 'during fetch') await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    localStorage.setItem('token', 'B');
    resolve(phase === 'before fetch' ? missing() : new Response(JSON.stringify({ updatedAt: '2026-09-15T01:00:00Z' }), { status: 200 }));
    await outcome;
    expect(fetchMock).toHaveBeenCalledTimes(phase === 'before fetch' ? 1 : 2);
    expect(localStorage.getItem('token')).toBe('B');
  });
});

describe('API mutation transaction keys', () => {
  beforeEach(() => {
    api.clearToken();
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ));
  });

  afterEach(() => {
    api.clearToken();
  });

  it('adds a unique transaction key to every ordinary mutation', async () => {
    await api.post('/trips', { customerId: 1 });
    await api.put('/trips/1', { version: 0 });

    const calls = vi.mocked(fetch).mock.calls;
    const firstHeaders = calls[0]?.[1]?.headers as Record<string, string>;
    const secondHeaders = calls[1]?.[1]?.headers as Record<string, string>;

    expect(firstHeaders['Idempotency-Key']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(secondHeaders['Idempotency-Key']).not.toBe(firstHeaders['Idempotency-Key']);
  });

  it('rotates the key after a definitive response for a later identical command', async () => {
    await api.post('/trips', { customerId: 1 });
    await api.post('/trips', { customerId: 1 });

    const calls = vi.mocked(fetch).mock.calls;
    const firstHeaders = calls[0]?.[1]?.headers as Record<string, string>;
    const secondHeaders = calls[1]?.[1]?.headers as Record<string, string>;
    expect(secondHeaders['Idempotency-Key']).not.toBe(firstHeaders['Idempotency-Key']);
  });

  it('preserves a caller-supplied stable key for explicit replay', async () => {
    await api.post('/shipments/quick', { customerId: 1 }, {
      idempotencyKey: 'stable-offline-replay-key',
    });

    const headers = vi.mocked(fetch).mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('stable-offline-replay-key');
  });

  it('reuses one key for concurrent double-submit of the same logical command', async () => {
    const resolvers: Array<(response: Response) => void> = [];
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>((resolve) => {
      resolvers.push(resolve);
    }));

    const first = api.post('/fleet/tires/1/install', { truckId: 3, position: 'FL' });
    const second = api.post('/fleet/tires/1/install', { truckId: 3, position: 'FL' });

    const calls = vi.mocked(fetch).mock.calls;
    const firstHeaders = calls[0]?.[1]?.headers as Record<string, string>;
    const secondHeaders = calls[1]?.[1]?.headers as Record<string, string>;
    expect(secondHeaders['Idempotency-Key']).toBe(firstHeaders['Idempotency-Key']);

    for (const resolve of resolvers) {
      resolve(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    }
    await Promise.all([first, second]);
  });

  it('reuses the command key after a network failure with an unknown outcome', async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError('network disconnected'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    await expect(api.post('/finance/fuel-invoices', { invoiceNumber: 'INV-1' }))
      .rejects.toThrow('network disconnected');
    await api.post('/finance/fuel-invoices', { invoiceNumber: 'INV-1' });

    const calls = vi.mocked(fetch).mock.calls;
    const firstHeaders = calls[0]?.[1]?.headers as Record<string, string>;
    const retryHeaders = calls[1]?.[1]?.headers as Record<string, string>;
    expect(retryHeaders['Idempotency-Key']).toBe(firstHeaders['Idempotency-Key']);
  });

  it('reuses one stable key for multipart retries when the caller supplies a retry fingerprint', async () => {
    const firstForm = new FormData();
    firstForm.append('file', new Blob(['abc'], { type: 'text/plain' }), 'a.txt');
    const secondForm = new FormData();
    secondForm.append('file', new Blob(['abc'], { type: 'text/plain' }), 'a.txt');

    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError('network disconnected'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    await expect(api.upload('/upload', firstForm, {
      retryFingerprint: 'multipart:a.txt:3:text/plain:1',
    })).rejects.toThrow('network disconnected');
    await api.upload('/upload', secondForm, {
      retryFingerprint: 'multipart:a.txt:3:text/plain:1',
    });

    const calls = vi.mocked(fetch).mock.calls;
    const firstHeaders = calls[0]?.[1]?.headers as Record<string, string>;
    const retryHeaders = calls[1]?.[1]?.headers as Record<string, string>;
    expect(retryHeaders['Idempotency-Key']).toBe(firstHeaders['Idempotency-Key']);
  });

  it('uses a caller-supplied multipart key unchanged', async () => {
    const form = new FormData();
    form.append('file', new Blob(['abc'], { type: 'text/plain' }), 'a.txt');

    await api.upload('/upload/company-logo', form, {
      idempotencyKey: 'company-logo-explicit-key',
    });

    const headers = vi.mocked(fetch).mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('company-logo-explicit-key');
  });

  it('does not attach a transaction key to reads', async () => {
    await api.get('/trips');

    const headers = vi.mocked(fetch).mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBeUndefined();
  });

  it('propagates catalog row versions from reads to update and delete preconditions', async () => {
    const originalUpdatedAt = '2026-07-27T10:00:00.000Z';
    const nextUpdatedAt = '2026-07-27T10:01:00.000Z';
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [{ id: 7, name: 'Cũ', updatedAt: originalUpdatedAt }],
        total: 1,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 7,
        name: 'Mới',
        updatedAt: nextUpdatedAt,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    await api.get('/routes?page=1');
    await api.put('/routes/7', { name: 'Mới' });
    await api.delete('/routes/7');

    const updateHeaders = vi.mocked(fetch).mock.calls[1]?.[1]?.headers as Record<string, string>;
    const deleteHeaders = vi.mocked(fetch).mock.calls[2]?.[1]?.headers as Record<string, string>;
    expect(updateHeaders['If-Unmodified-Since']).toBe(originalUpdatedAt);
    expect(deleteHeaders['If-Unmodified-Since']).toBe(nextUpdatedAt);
  });

  it('propagates single-object versions from reads to base-path updates (fuel-config, company-info)', async () => {
    // GET /api/fuel-config returns a single object with `id` and `updatedAt`,
    // while PUT goes to the same base path (no id). The previous cache logic
    // stored the version under `/api/fuel-config/1` and the PUT lookup against
    // `/api/fuel-config` always missed — backend then rejected with
    // "Thiếu phiên bản cấu hình nhiên liệu".
    const originalUpdatedAt = '2026-08-03T16:40:36.116Z';
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 1,
        loadedNorm: '35.00',
        emptyNorm: '22.00',
        updatedAt: originalUpdatedAt,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        actionKind: 'PRICE_CONFIG_CHANGE',
        status: 'PENDING_CHECK',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    await api.get('/fuel-config');
    await api.put('/fuel-config', { loadedNorm: 35, emptyNorm: 22 });

    const putHeaders = vi.mocked(fetch).mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(putHeaders['If-Unmodified-Since']).toBe(originalUpdatedAt);
  });
});

describe('Vitest infrastructure', () => {
  it('runs basic assertions', () => {
    expect(1 + 1).toBe(2);
    expect('hello').toBeTruthy();
    expect([1, 2, 3]).toHaveLength(3);
  });

  it('supports jsdom environment', () => {
    // jsdom provides a minimal DOM implementation
    const div = document.createElement('div');
    div.textContent = 'test';
    expect(div.textContent).toBe('test');
  });

  it('supports module resolution via workspace package', async () => {
    // Verify the @tingting/shared workspace package resolves correctly
    const mod = await import('@tingting/shared');
    expect(mod.round2dp).toBeDefined();
  });
});
