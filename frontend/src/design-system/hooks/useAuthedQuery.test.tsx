import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../lib/api';
import { qk } from '../../api/keys';
import { onSessionExpired } from '../../lib/api/session';
import { getToken } from '../../lib/token';
import { useAuthedQuery } from './useAuthedQuery';

const { logout } = vi.hoisted(() => ({ logout: vi.fn() }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ logout }) }));

function createWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('authenticated query session ownership', () => {
  beforeEach(() => { api.clearToken(); logout.mockReset(); });
  afterEach(() => { api.clearToken(); vi.unstubAllGlobals(); });

  it('propagates a late A401 without logging out B before its storage event arrives', async () => {
    api.setToken('session-A');
    let resolveResponse!: (response: Response) => void;
    const fetchMock = vi.fn().mockReturnValue(new Promise<Response>((resolve) => { resolveResponse = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    const expired = vi.fn();
    const unsubscribe = onSessionExpired(expired);
    try {
      const { result } = renderHook(() => useAuthedQuery({
        queryKey: qk.shipmentsCus.list({ page: 1 }), queryFn: () => api.get('/shipments'),
      }), { wrapper: createWrapper() });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
      expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer session-A');
      localStorage.setItem('token', 'session-B');
      resolveResponse(new Response(JSON.stringify({ error: 'Session A expired' }), { status: 401 }));
      await waitFor(() => expect(result.current.error).toBeInstanceOf(ApiError));
      expect(result.current.error).toMatchObject({ status: 401 });
      expect(localStorage.getItem('token')).toBe('session-B');
      expect(getToken()).toBe('session-B');
      expect(expired).not.toHaveBeenCalled();
      expect(logout).not.toHaveBeenCalled();
    } finally { unsubscribe(); }
  });

  it('lets the API expire the current token exactly once without a second logout', async () => {
    api.setToken('current-session');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    const expired = vi.fn();
    const unsubscribe = onSessionExpired(expired);
    try {
      const { result } = renderHook(() => useAuthedQuery({
        queryKey: qk.shipmentsCus.list({ page: 1 }), queryFn: () => api.get('/shipments'),
      }), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.error).toMatchObject({ status: 401 }));
      expect(getToken()).toBeNull();
      expect(expired).toHaveBeenCalledOnce();
      expect(logout).not.toHaveBeenCalled();
    } finally { unsubscribe(); }
  });

  it('propagates custom permission errors without destroying the session', async () => {
    api.setToken('allowed-session');
    const error = new ApiError(403, null, 'Không có quyền');
    const { result } = renderHook(() => useAuthedQuery({
      queryKey: qk.shipmentsCus.list({ page: 1 }), queryFn: async () => { throw error; },
    }), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.error).toBe(error));
    expect(getToken()).toBe('allowed-session');
    expect(logout).not.toHaveBeenCalled();
  });
});
