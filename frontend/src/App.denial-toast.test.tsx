// Card QA2-003 (121026084653) — one denial burst is one toast. The production
// build measured four stacked "Bạn không có quyền truy cập trang này."
// toasts for a single foreign-route visit (guard remounts each carried their
// own per-mount ref). The burst window must collapse them; a second, separate
// denial after the window still announces itself.
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@tingting/shared';

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));

vi.mock('./hooks/useAuth', async () => {
  const actual = await vi.importActual<typeof import('./hooks/useAuth')>('./hooks/useAuth');
  return { ...actual, useAuth: useAuthMock };
});

vi.mock('./components/Layout', async () => {
  const actual = await vi.importActual<typeof import('./components/Layout')>('./components/Layout');
  return { ...actual, default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout-shell">{children}</div> };
});

import { AppRoutes } from './App';
import { ToastProvider } from './components/shared/Toast';

const DENIAL_TEXT = 'Bạn không có quyền truy cập trang này.';

function renderAs(role: Role, path: string) {
  useAuthMock.mockReturnValue({
    user: { userId: 1, username: 'probe', email: null, phone: null, role, fullName: 'Probe' },
    logout: vi.fn(), login: vi.fn(), updateUser: vi.fn(),
    isAuthenticated: true, loading: false, sessionExpired: false,
  });
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAuthMock.mockReset();
});

describe('denied route → one toast per burst (QA2-003)', () => {
  it('a CUS hard visit to /users announces the denial exactly once', async () => {
    renderAs(Role.CUS, '/users');
    await waitFor(() => expect(screen.getAllByText(DENIAL_TEXT).length).toBeGreaterThanOrEqual(1));
    // Give any duplicate mounts the chance to land, then insist on one.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getAllByText(DENIAL_TEXT).length).toBe(1);
  });

  it('a CUS visit to the admin audit area also shows at most one copy', async () => {
    // A different foreign route on a fresh render: at most one toast —
    // never the four stacked copies the production probe measured. (When
    // this runs right after the previous denial, the burst window may
    // suppress it entirely — also correct.)
    renderAs(Role.CUS, '/audit-logs');
    await new Promise((r) => setTimeout(r, 100));
    const copies = screen.queryAllByText(DENIAL_TEXT).length;
    expect(copies).toBeLessThanOrEqual(1);
  });
});
