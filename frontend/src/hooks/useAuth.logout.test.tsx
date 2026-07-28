import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  clearAgentConversationMock,
  disposeAgentSocketMock,
} = vi.hoisted(() => ({
  clearAgentConversationMock: vi.fn(),
  disposeAgentSocketMock: vi.fn(),
}));

vi.mock('../api/agentClient', () => ({
  clearAgentConversation: clearAgentConversationMock,
  disposeAgentSocket: disposeAgentSocketMock,
}));

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

describe('AuthProvider logout', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('localStorage', createStorageStub());
    localStorage.clear();
    clearAgentConversationMock.mockReset();
    disposeAgentSocketMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts /auth/logout before clearing local auth state', async () => {
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

    expect(localStorage.getItem('token')).toBe(VALID_TEST_JWT);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/auth/logout');

    logoutDeferred.resolve(new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    await waitFor(() => {
      expect(screen.getByTestId('auth-state').textContent).toBe('signed-out');
    });
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('pending_logout_tokens')).toBeNull();
    expect(queryClient.getQueryData(['financial', 'customer-a'])).toBeUndefined();
    expect(disposeAgentSocketMock).toHaveBeenCalledOnce();
    expect(clearAgentConversationMock).toHaveBeenCalledOnce();
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
    expect(disposeAgentSocketMock).toHaveBeenCalledOnce();
    expect(clearAgentConversationMock).toHaveBeenCalledOnce();

    window.dispatchEvent(new Event('online'));
    await waitFor(() => {
      expect(localStorage.getItem('pending_logout_tokens')).toBeNull();
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
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
