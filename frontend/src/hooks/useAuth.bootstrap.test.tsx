import { render, screen, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../lib/api';
import { getToken } from '../lib/token';
import { AuthProvider, useAuth } from './useAuth';

function AuthProbe() {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <div>loading</div>;
  return <output data-testid="auth-state">{isAuthenticated ? 'signed-in' : 'signed-out'}</output>;
}

function renderWithAuth(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>,
  );
}

/** Realistic HS256-shaped JWT: base64URL payload, UTF-8 safe, future exp. */
const SERVER_VALID_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.'
  + btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({
    sub: 'ketoan',
    fullName: 'Nguyễn Kế Toán',
    role: 'ACCOUNTANT',
    exp: 4_102_444_800,
  }))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  + '.sig';

const AUTH_ME_200 = () => new Response(JSON.stringify({ id: 7, role: 'ACCOUNTANT', username: 'ketoan' }), { status: 200 });

describe('AuthProvider cold-boot bootstrap (card 20260922_82)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // The token module caches across tests (module singleton) — clear both
    // layers, not just storage.
    api.clearToken();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('REPRO: clock-skewed full load keeps a server-valid token and restores the session', async () => {
    // The card's signature: local decode reads the token as expired (client
    // clock ahead of the server) while the server accepts it. The token below
    // carries exp=1 (long past by local clock) but /auth/me answers 200 —
    // exactly the oh-my-pi observation (Bearer → 200 via sync XHR).
    api.setToken('eyJhbGciOiJIUzI1NiJ9.'
      + btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({ sub: 'ketoan', exp: 1 }))))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
      + '.sig');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(AUTH_ME_200());

    renderWithAuth(<AuthProbe />);

    await waitFor(() => expect(screen.getByTestId('auth-state')).toHaveTextContent('signed-in'));
    // The bootstrap must have consulted the SERVER before any decision.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const headers = (init as RequestInit | undefined)?.headers as Record<string, string> | undefined;
    expect(String(headers?.['Authorization'])).toContain('Bearer');
    // The token survives the cold boot.
    expect(window.localStorage.getItem('token')).toBe(getToken());
    expect(window.localStorage.getItem('token')).toBeTruthy();
  });

  it('genuine server rejection (401) still clears the token and signs out', async () => {
    api.setToken(SERVER_VALID_TOKEN);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    );

    renderWithAuth(<AuthProbe />);

    await waitFor(() => expect(screen.getByTestId('auth-state')).toHaveTextContent('signed-out'));
    expect(window.localStorage.getItem('token')).toBeNull();
  });

  it('transient 503 keeps the token and surfaces the retry screen', async () => {
    api.setToken(SERVER_VALID_TOKEN);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Unavailable' }), { status: 503 }),
    );

    renderWithAuth(<AuthProbe />);

    await waitFor(() => expect(screen.getByText('Chưa tải được tài khoản')).toBeInTheDocument());
    expect(window.localStorage.getItem('token')).toBeTruthy();
  });

  it('no token at all: signed out without touching the network', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    renderWithAuth(<AuthProbe />);
    await waitFor(() => expect(screen.getByTestId('auth-state')).toHaveTextContent('signed-out'));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
