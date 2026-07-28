import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';
import { onSessionExpired } from './api/session';
import { getToken } from '../design-system/hooks/useToken';

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

  it('preserves a caller-supplied stable key for explicit replay', async () => {
    await api.post('/shipments/quick', { customerId: 1 }, {
      headers: { 'Idempotency-Key': 'stable-offline-replay-key' },
    });

    const headers = vi.mocked(fetch).mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('stable-offline-replay-key');
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
