import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../lib/api';
import { AuthProvider, useAuth } from './useAuth';

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
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('localStorage', createStorageStub());
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
    expect(localStorage.getItem('pending_logout_tokens')).toContain(VALID_TEST_JWT);
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
    expect(localStorage.getItem('pending_logout_tokens')).toContain(VALID_TEST_JWT);
    expect(queryClient.getQueryData(['customers', 'customer-a'])).toBeUndefined();

    window.dispatchEvent(new Event('online'));
    await waitFor(() => {
      expect(localStorage.getItem('pending_logout_tokens')).toBeNull();
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
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
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('pending_logout_tokens')).toBeNull();
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('clears protected query data before a different user becomes authenticated', async () => {
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
