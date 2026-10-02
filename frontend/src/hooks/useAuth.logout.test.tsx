import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../lib/api';
import { AuthProvider, useAuth } from './useAuth';
import { qk } from '../api/keys';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function AuthProbe() {
  const { isAuthenticated, loading, login, logout } = useAuth();
  if (loading) return <div>loading</div>;
  return (
    <div>
      <output data-testid="auth-state">{isAuthenticated ? 'signed-in' : 'signed-out'}</output>
      <button type="button" onClick={() => void login('next-user', 'password')}>login</button>
      <button type="button" onClick={() => logout()}>logout</button>
      <button type="button" onClick={() => logout({ revoke: false })}>logout-skip-revoke</button>
    </div>
  );
}

function renderWithAuth(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>,
  );
  return { ...rendered, queryClient };
}

function createStorageStub() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
}

const VALID_TEST_JWT = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJleHAiOjQxMDI0NDQ4MDB9.signature';
const EXPIRED_TEST_JWT = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJleHAiOjF9.signature';

describe('AuthProvider logout', () => {
  it('retains a valid session and retries explicitly after a cold-load server failure', async () => {
    api.setToken(VALID_TEST_JWT);
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Unavailable' }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 7, username: 'cus', role: 'CUS' }), { status: 200 }));
    renderWithAuth(<AuthProbe />);
    await screen.findByRole('heading', { name: 'Chưa tải được tài khoản' });
    expect(localStorage.getItem('token')).toBe(VALID_TEST_JWT);
    expect(screen.queryByTestId('auth-state')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    await waitFor(() => expect(screen.getByTestId('auth-state')).toHaveTextContent('signed-in'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('localStorage', createStorageStub());
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('preserves a newer remote login when local logout precedes the storage event', async () => {
    api.setToken(VALID_TEST_JWT);
    const tokenB = VALID_TEST_JWT + '-B';
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>)?.Authorization;
      return new Response(JSON.stringify(url.endsWith('/auth/logout') ? { success: true } : {
        id: auth === `Bearer ${tokenB}` ? 2 : 1, username: 'user', email: null, phone: null,
        role: auth === `Bearer ${tokenB}` ? 'DRIVER' : 'ADMIN',
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { queryClient } = renderWithAuth(<AuthProbe />);
    await screen.findByTestId('auth-state');
    localStorage.setItem('token', tokenB);
    fireEvent.click(screen.getByRole('button', { name: /^logout$/ }));
    expect(localStorage.getItem('token')).toBe(tokenB);
    await waitFor(() => expect(queryClient.getQueryData(qk.auth.me)).toMatchObject({ userId: 2, role: 'DRIVER' }));
    const revocations = fetchMock.mock.calls.filter(([url]) => url.endsWith('/auth/logout'));
    expect(revocations.every(([, init]) => (init?.headers as Record<string, string>).Authorization === `Bearer ${VALID_TEST_JWT}`)).toBe(true);
  });

  it('logs out the displayed actor even if a late response refreshed the token cache first', async () => {
    api.setToken(VALID_TEST_JWT);
    const tokenB = VALID_TEST_JWT + '-B';
    const pending = createDeferred<Response>();
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/trucks/42')) return pending.promise;
      const auth = (init?.headers as Record<string, string>)?.Authorization;
      return new Response(JSON.stringify(url.endsWith('/auth/logout') ? { success: true } : {
        id: auth === `Bearer ${tokenB}` ? 2 : 1, username: 'user', email: null, phone: null,
        role: auth === `Bearer ${tokenB}` ? 'DRIVER' : 'ADMIN',
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { queryClient } = renderWithAuth(<AuthProbe />);
    await screen.findByTestId('auth-state');
    const oldRead = api.get('/trucks/42');
    localStorage.setItem('token', tokenB);
    pending.resolve(new Response('{}', { status: 200 }));
    await oldRead;
    fireEvent.click(screen.getByRole('button', { name: /^logout$/ }));
    expect(localStorage.getItem('token')).toBe(tokenB);
    await waitFor(() => expect(queryClient.getQueryData(qk.auth.me)).toMatchObject({ userId: 2 }));
    const revocations = fetchMock.mock.calls.filter(([url]) => url.endsWith('/auth/logout'));
    expect(revocations.every(([, init]) => (init?.headers as Record<string, string>).Authorization === `Bearer ${VALID_TEST_JWT}`)).toBe(true);
  });

  it('rotates retained mutation identity after another tab switches accounts', async () => {
    api.setToken(VALID_TEST_JWT);
    let mutationCalls = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/trucks')) {
        mutationCalls += 1;
        return new Response('{}', { status: mutationCalls === 1 ? 503 : 200 });
      }
      return new Response(JSON.stringify({ id: 1, username: 'user', email: null, phone: null, role: 'ADMIN' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithAuth(<AuthProbe />);
    await screen.findByTestId('auth-state');
    await expect(api.post('/trucks', { plate: 'QA' })).rejects.toMatchObject({ status: 503 });
    act(() => {
      localStorage.setItem('token', VALID_TEST_JWT + '-B');
      window.dispatchEvent(new StorageEvent('storage', { key: 'token' }));
    });
    await api.post('/trucks', { plate: 'QA' });
    const calls = fetchMock.mock.calls.filter(([url]) => url.endsWith('/trucks'));
    const key = (call: unknown[]) => ((call[1] as RequestInit).headers as Record<string, string>)['Idempotency-Key'];
    expect(key(calls[0])).not.toBe(key(calls[1]));
  });

  it('does not overwrite a remote identity with a late login response', async () => {
    api.clearToken();
    const pending = createDeferred<Response>();
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(pending.promise));
    let performLogin!: ReturnType<typeof useAuth>['login'];
    function LoginProbe() { performLogin = useAuth().login; return <div>ready</div>; }
    renderWithAuth(<LoginProbe />);
    await screen.findByText('ready');
    const attempt = performLogin('A', 'password');
    const outcome = expect(attempt).rejects.toMatchObject({ status: 409 });
    localStorage.setItem('token', VALID_TEST_JWT + '-B');
    await act(async () => {
      pending.resolve(new Response(JSON.stringify({ token: VALID_TEST_JWT + '-A', user: {
        id: 1, username: 'A', email: null, phone: null, role: 'ADMIN',
      } }), { status: 200 }));
      await outcome;
    });
    expect(localStorage.getItem('token')).toBe(VALID_TEST_JWT + '-B');
  });

  it('clears local auth state immediately; the revocation posts asynchronously', async () => {
    const logoutDeferred = createDeferred<Response>();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        userId: 1,
        username: 'admin',
        email: null,
        phone: null,
        role: 'ADMIN',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockImplementationOnce(() => logoutDeferred.promise);
    vi.stubGlobal('fetch', fetchMock);

    localStorage.setItem('token', VALID_TEST_JWT);
    api.refreshTokenFromStorage();
    const { queryClient } = renderWithAuth(<AuthProbe />);

    expect((await screen.findByTestId('auth-state')).textContent).toBe('signed-in');
    queryClient.setQueryData(['financial', 'customer-a'], { outstanding: 123_000 });
    fireEvent.click(screen.getByRole('button', { name: 'logout' }));

    // Teardown does not wait for the revocation request: the session is gone
    // while the fetch is still unsettled (a hung fetch must never keep the
    // user signed in).
    await waitFor(() => {
      expect(screen.getByTestId('auth-state').textContent).toBe('signed-out');
    });
    expect(localStorage.getItem('token')).toBeNull();
    expect(queryClient.getQueryData(['financial', 'customer-a'])).toBeUndefined();
    // The revocation was still fired.
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/auth/logout');

    logoutDeferred.resolve(new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    await waitFor(() => {
      expect(localStorage.getItem('pending_logout_tokens')).toBeNull();
    });
  });

  it('clears local auth state even when the revocation fetch never resolves (hung network)', async () => {
    const hungLogout = createDeferred<Response>();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        userId: 1,
        username: 'admin',
        email: null,
        phone: null,
        role: 'ADMIN',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockImplementationOnce(() => hungLogout.promise);
    vi.stubGlobal('fetch', fetchMock);

    localStorage.setItem('token', VALID_TEST_JWT);
    api.refreshTokenFromStorage();
    const { queryClient } = renderWithAuth(<AuthProbe />);

    expect((await screen.findByTestId('auth-state')).textContent).toBe('signed-in');
    queryClient.setQueryData(['financial', 'customer-a'], { outstanding: 123_000 });
    fireEvent.click(screen.getByRole('button', { name: 'logout' }));

    // The prod bug (user stuck signed in): the revocation fetch hangs, but
    // the local session must still be gone, and a re-tap must not be
    // swallowed into a permanently in-flight logout.
    await waitFor(() => {
      expect(screen.getByTestId('auth-state').textContent).toBe('signed-out');
    });
    expect(localStorage.getItem('token')).toBeNull();
    expect(queryClient.getQueryData(['financial', 'customer-a'])).toBeUndefined();
    expect(localStorage.getItem('pending_logout_tokens')).toBeNull();
    // Re-tap while the revocation phase is in flight: the teardown is already
    // done, so this is a harmless no-op (token stays cleared).
    fireEvent.click(screen.getByRole('button', { name: 'logout' }));
    expect(localStorage.getItem('token')).toBeNull();

    hungLogout.resolve(new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    await waitFor(() => {
      expect(localStorage.getItem('pending_logout_tokens')).toBeNull();
    });
  });

  it('still clears local auth state when the logout request fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        userId: 1,
        username: 'admin',
        email: null,
        phone: null,
        role: 'ADMIN',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockRejectedValueOnce(new Error('network down'))
      .mockRejectedValueOnce(new Error('network still down'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    localStorage.setItem('token', VALID_TEST_JWT);
    api.refreshTokenFromStorage();
    const { queryClient } = renderWithAuth(<AuthProbe />);

    expect((await screen.findByTestId('auth-state')).textContent).toBe('signed-in');
    queryClient.setQueryData(['customers', 'customer-a'], { name: 'Customer A' });
    fireEvent.click(screen.getByRole('button', { name: 'logout' }));

    await waitFor(() => {
      expect(screen.getByTestId('auth-state').textContent).toBe('signed-out');
    });
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('pending_logout_tokens')).toBeNull();
    expect(queryClient.getQueryData(['customers', 'customer-a'])).toBeUndefined();

    window.dispatchEvent(new Event('online'));
    await waitFor(() => {
      expect(localStorage.getItem('pending_logout_tokens')).toBeNull();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('drops the token instead of retrying when the server already rejected it (401)', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        userId: 1,
        username: 'admin',
        email: null,
        phone: null,
        role: 'ADMIN',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Token đã bị thu hồi' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockImplementation(() => Promise.reject(new Error('unexpected fetch')));
    vi.stubGlobal('fetch', fetchMock);

    localStorage.setItem('token', VALID_TEST_JWT);
    api.refreshTokenFromStorage();
    renderWithAuth(<AuthProbe />);

    expect((await screen.findByTestId('auth-state')).textContent).toBe('signed-in');
    fireEvent.click(screen.getByRole('button', { name: 'logout' }));

    await waitFor(() => {
      expect(screen.getByTestId('auth-state').textContent).toBe('signed-out');
    });
    // 401 = the token is dead server-side; it must leave the pending queue
    // rather than being retried (and 401-ing) on every reconnect/logout.
    expect(localStorage.getItem('pending_logout_tokens')).toBeNull();
    expect(localStorage.getItem('token')).toBeNull();

    window.dispatchEvent(new Event('online'));
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('skips the logout network call entirely with revoke: false (change-password flow)', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        userId: 1,
        username: 'admin',
        email: null,
        phone: null,
        role: 'ADMIN',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockImplementation(() => Promise.reject(new Error('unexpected fetch')));
    vi.stubGlobal('fetch', fetchMock);

    localStorage.setItem('token', VALID_TEST_JWT);
    api.refreshTokenFromStorage();
    const { queryClient } = renderWithAuth(<AuthProbe />);

    expect((await screen.findByTestId('auth-state')).textContent).toBe('signed-in');
    queryClient.setQueryData(['financial', 'customer-a'], { outstanding: 123_000 });
    fireEvent.click(screen.getByRole('button', { name: 'logout-skip-revoke' }));

    await waitFor(() => {
      expect(screen.getByTestId('auth-state').textContent).toBe('signed-out');
    });
    // Only the initial /auth/me fetch happened — no /auth/logout attempt,
    // because the change-password request already revoked this token.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('pending_logout_tokens')).toBeNull();
    expect(queryClient.getQueryData(['financial', 'customer-a'])).toBeUndefined();
  });

  it('does not attempt server revocation for an already-expired token', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        userId: 1,
        username: 'admin',
        email: null,
        phone: null,
        role: 'ADMIN',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      // Card 20260922_82: the post-swap me-refetch now REACHES the server
      // (bootstrap no longer self-evicts a locally-expired token); the
      // server's 401 is what evicts it.
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }))
      .mockImplementation(() => Promise.reject(new Error('unexpected fetch')));
    vi.stubGlobal('fetch', fetchMock);

    localStorage.setItem('token', VALID_TEST_JWT);
    api.refreshTokenFromStorage();
    renderWithAuth(<AuthProbe />);

    expect((await screen.findByTestId('auth-state')).textContent).toBe('signed-in');
    // Token expires while the tab sits open (no query has 401'd yet).
    localStorage.setItem('token', EXPIRED_TEST_JWT);
    api.refreshTokenFromStorage();
    fireEvent.click(screen.getByRole('button', { name: 'logout' }));

    await waitFor(() => {
      expect(screen.getByTestId('auth-state').textContent).toBe('signed-out');
    });
    // jwt.verify would reject the expired token before the logout route, so
    // sending it can only produce a pointless 401.
    // Two /auth/me calls have fired by now (bootstrap + the post-swap
    // me-refetch — card 20260922_82 server-verdict bootstrap); the intent
    // pin is that ZERO of them hit /auth/logout.
    const revocations = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/logout'));
    expect(revocations).toHaveLength(0);
    expect(localStorage.getItem('pending_logout_tokens')).toBeNull();
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('clears protected query data before a different user becomes authenticated', async () => {
    // Card 20260922_82: reset the module token cache so a stale token from a
    // previous test cannot trigger a bootstrap /auth/me against this test's
    // response queue (pre-fix the stale token silently self-evicted).
    api.clearToken();
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      token: VALID_TEST_JWT,
      user: {
        userId: 2,
        username: 'next-user',
        email: null,
        phone: null,
        role: 'MANAGER',
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { queryClient } = renderWithAuth(<AuthProbe />);
    expect((await screen.findByTestId('auth-state')).textContent).toBe('signed-out');
    queryClient.setQueryData(['financial', 'previous-user'], { revenue: 999_000 });

    fireEvent.click(screen.getByRole('button', { name: 'login' }));

    await waitFor(() => {
      expect(screen.getByTestId('auth-state').textContent).toBe('signed-in');
    });
    expect(queryClient.getQueryData(['financial', 'previous-user'])).toBeUndefined();
    expect(localStorage.getItem('token')).toBe(VALID_TEST_JWT);
  });
});

