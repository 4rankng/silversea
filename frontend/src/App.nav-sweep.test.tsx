import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@tingting/shared';

const { authState } = vi.hoisted(() => ({ authState: { role: 'CUS' as Role, capabilities: [] as string[] } }));

vi.mock('./hooks/useAuth', async () => {
  const actual = await vi.importActual<typeof import('./hooks/useAuth')>('./hooks/useAuth');
  return {
    ...actual,
    useAuth: () => ({
      user: {
        userId: 1, username: 'sweep', email: null, phone: null,
        role: authState.role, fullName: 'Nav Sweep', capabilities: authState.capabilities,
      },
      logout: vi.fn(), login: vi.fn(), updateUser: vi.fn(),
      isAuthenticated: true, loading: false, sessionExpired: false,
    }),
  };
});

vi.mock('./lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({}),
    getBlob: vi.fn().mockResolvedValue(new Blob()),
    post: vi.fn().mockResolvedValue({}),
    put: vi.fn().mockResolvedValue({}),
    patch: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('./components/Layout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./components/Layout')>();
  return {
    ...actual,
    default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout-shell">{children}</div>,
  };
});

import { AppRoutes } from './App';
import { getNavItems } from './components/Layout';

function RouteProbe({ log }: { log: string[] }) {
  const location = useLocation();
  log[0] = location.pathname + location.search;
  return null;
}

// Card 20260922_29 AC3: every sidebar item of every role must OPEN — the
// route guards and the nav derive from the same permission source, so no
// nav path may bounce the role to a fallback. Rendering the real route
// table per role/path with a stubbed api catches any nav entry the guard
// does not admit.
describe('nav sweep — every sidebar item opens for its role', () => {
  beforeEach(() => {
    authState.role = Role.CUS;
    authState.capabilities = [];
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  const ROLES = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT, Role.CUS, Role.OPS, Role.DISPATCHER, Role.DRIVER];

  // Heavy by design: ~20 full route mounts per role — sized explicitly
  // so first-run transform load cannot eat the default 5s (rotating-timeout
  // class, see vitest-suite-rotation lesson).
  it.each(ROLES)('sweeps every %s nav item without a redirect', { timeout: 60_000 }, async (role) => {
    authState.role = role;
    const items = getNavItems(role, undefined, undefined, authState.capabilities);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      const log: string[] = [];
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const { unmount } = render(
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[item.path]}>
            <RouteProbe log={log} />
            <AppRoutes />
          </MemoryRouter>
        </QueryClientProvider>,
      );
      await waitFor(() => { expect(log[0]).toBeTruthy(); });
      expect(log[0]).toBe(item.path);
      unmount();
    }
    expect(screen.queryByText('driver')).toBeNull();
  });
});
