import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../lib/api';
import { onSessionIdentityChanged, type SessionIdentityChangeEvent } from '../lib/api/session';
import { AuthProvider, useAuth } from './useAuth';

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

/** Cross-tab logins surface here only through the storage event — the same
 *  document never receives one for its own writes. storageArea is omitted:
 *  a stubbed localStorage is not a real Storage instance, and token.ts only
 *  uses it to REJECT events from other storage areas. */
function fireCrossTabTokenChange(nextValue: string | null) {
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'token',
      newValue: nextValue,
    }));
  });
}

function AuthProbe() {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <div>loading</div>;
  return <output data-testid="auth-state">{isAuthenticated ? 'signed-in' : 'signed-out'}</output>;
}

function renderWithAuth() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider><AuthProbe /></AuthProvider>
    </QueryClientProvider>,
  );
  return { ...rendered, queryClient };
}

const TOKEN_A = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJleHAiOjQxMDI0NDQ4MDB9.a';
const TOKEN_B = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJleHAiOjQxMDI0NDQ4MDB9.b';

/** /me answers with an identity keyed off the bearer token, the way the
 *  server does: whichever token the shared storage holds decides the user. */
function mockMeByToken(tokenAUser: { id: number; role: string; fullName?: string }, tokenBUser: { id: number; role: string; fullName?: string }) {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => new Response(JSON.stringify({
    id: (init?.headers as Record<string, string>)?.Authorization === `Bearer ${TOKEN_B}`
      ? tokenBUser.id
      : tokenAUser.id,
    username: 'user',
    email: null,
    phone: null,
    role: (init?.headers as Record<string, string>)?.Authorization === `Bearer ${TOKEN_B}`
      ? tokenBUser.role
      : tokenAUser.role,
    fullName: (init?.headers as Record<string, string>)?.Authorization === `Bearer ${TOKEN_B}`
      ? tokenBUser.fullName
      : tokenAUser.fullName,
  }), { status: 200 }));
}

describe('AuthProvider cross-tab identity events (QA R27)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('localStorage', createStorageStub());
    localStorage.clear();
    // Reset the module-level token cache too — a stale value from a previous
    // test would make the cold-boot query fire a real network request.
    api.setToken(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('announces a cross-tab login that swaps to a different user', async () => {
    api.setToken(TOKEN_A);
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockImplementation(mockMeByToken(
        { id: 1, role: 'ADMIN', fullName: 'Quản trị' },
        { id: 9, role: 'ACCOUNTANT', fullName: 'Hoa Phạm' },
      ));
    const events: SessionIdentityChangeEvent[] = [];
    const unsubscribe = onSessionIdentityChanged((event) => events.push(event));

    renderWithAuth();
    await waitFor(() => expect(screen.getByTestId('auth-state')).toHaveTextContent('signed-in'));

    // Another tab (same browser profile) signs in as the accountant.
    localStorage.setItem('token', TOKEN_B);
    fireCrossTabTokenChange(TOKEN_B);

    await waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toEqual({
      kind: 'cross-tab-login',
      previous: { userId: 1, fullName: 'Quản trị', role: 'ADMIN' },
      current: { userId: 9, fullName: 'Hoa Phạm', role: 'ACCOUNTANT' },
    });
    unsubscribe();
    expect(fetchMock).toHaveBeenCalled();
  });

  it('stays silent when another tab re-logs the SAME user (token refresh)', async () => {
    api.setToken(TOKEN_A);
    vi.spyOn(globalThis, 'fetch')
      .mockImplementation(mockMeByToken(
        { id: 1, role: 'ADMIN', fullName: 'Quản trị' },
        { id: 1, role: 'ADMIN', fullName: 'Quản trị' },
      ));
    const events: SessionIdentityChangeEvent[] = [];
    const unsubscribe = onSessionIdentityChanged((event) => events.push(event));

    renderWithAuth();
    await waitFor(() => expect(screen.getByTestId('auth-state')).toHaveTextContent('signed-in'));

    const tokenA2 = TOKEN_A + '-refreshed';
    localStorage.setItem('token', tokenA2);
    fireCrossTabTokenChange(tokenA2);

    // Give the resync a chance to (wrongly) fire, then assert it never did.
    await waitFor(() => expect(screen.getByTestId('auth-state')).toHaveTextContent('signed-in'));
    expect(events).toEqual([]);
    unsubscribe();
  });

  it('announces a cross-tab logout (shared token removed elsewhere)', async () => {
    api.setToken(TOKEN_A);
    vi.spyOn(globalThis, 'fetch')
      .mockImplementation(mockMeByToken({ id: 1, role: 'ADMIN', fullName: 'Quản trị' }, { id: 9, role: 'ACCOUNTANT' }));
    const events: SessionIdentityChangeEvent[] = [];
    const unsubscribe = onSessionIdentityChanged((event) => events.push(event));

    renderWithAuth();
    await waitFor(() => expect(screen.getByTestId('auth-state')).toHaveTextContent('signed-in'));

    localStorage.removeItem('token');
    fireCrossTabTokenChange(null);

    await waitFor(() => expect(screen.getByTestId('auth-state')).toHaveTextContent('signed-out'));
    expect(events).toEqual([{
      kind: 'cross-tab-logout',
      previous: { userId: 1, fullName: 'Quản trị', role: 'ADMIN' },
    }]);
    unsubscribe();
  });

  it('does not announce anything on a cold boot with no prior session', async () => {
    const events: SessionIdentityChangeEvent[] = [];
    const unsubscribe = onSessionIdentityChanged((event) => events.push(event));

    renderWithAuth();
    await waitFor(() => expect(screen.getByTestId('auth-state')).toHaveTextContent('signed-out'));

    localStorage.removeItem('token');
    fireCrossTabTokenChange(null);
    expect(events).toEqual([]);
    unsubscribe();
  });
});
