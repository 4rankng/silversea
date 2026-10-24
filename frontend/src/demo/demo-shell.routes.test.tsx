/**
 * SIL-155 smoke: the six /demo/* routes render inside the demo shell, the
 * sidebar marks exactly the current route active (aria-current="page"), and
 * /demo redirects to /demo/dashboard. Pins the route wiring in App.tsx, the
 * shell (DemoAppShell) and the placeholder pages together — see
 * testplan/2026-10-24-sil155-demo-shell.md (TC-SIL155-01/02).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { Role } from '@tingting/shared';

const { authState } = vi.hoisted(() => ({
  authState: { isAuthenticated: true as boolean },
}));

vi.mock('../hooks/useAuth', async () => {
  const actual = await vi.importActual<typeof import('../hooks/useAuth')>('../hooks/useAuth');
  return {
    ...actual,
    useAuth: () => ({
      user: {
        userId: 1,
        username: 'admin',
        email: null,
        phone: null,
        role: 'ADMIN' as Role,
        fullName: 'Trần Nhật Quân',
      },
      logout: vi.fn(),
      login: vi.fn(),
      updateUser: vi.fn(),
      isAuthenticated: authState.isAuthenticated,
      loading: false,
      sessionExpired: false,
    }),
  };
});

import { ToastProvider } from '../components/shared/Toast';
import { AppRoutes } from '../App';
import { DEMO_NAV_ITEMS } from './nav';

function renderDemoRoute(path: string) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </ToastProvider>,
  );
}

function LocationProbe({ log }: { log: string[] }) {
  const location = useLocation();
  log[0] = location.pathname;
  return null;
}

describe('demo shell routes (SIL-155)', () => {
  it.each(DEMO_NAV_ITEMS.map((item) => [item.path, item] as const))(
    'renders %s with heading, breadcrumb and one active sidebar item',
    { timeout: 20_000 },
    async (path, item) => {
      renderDemoRoute(path);

      // Placeholder page heading (H1) inside the demo shell.
      expect(await screen.findByRole('heading', { level: 1, name: item.heading })).toBeInTheDocument();

      // Breadcrumb current segment mirrors the same page.
      expect(screen.getByTestId('demo-breadcrumb-current')).toHaveTextContent(item.heading);

      // Sidebar: every nav item is a link; only the current one is active.
      for (const nav of DEMO_NAV_ITEMS) {
        const link = screen.getByRole('link', { name: nav.label });
        if (nav.path === item.path) {
          expect(link).toHaveAttribute('aria-current', 'page');
        } else {
          expect(link).not.toHaveAttribute('aria-current');
        }
      }
    },
  );

  it('redirects /demo to /demo/dashboard', async () => {
    renderDemoRoute('/demo');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Tổng quan Đội xe' }),
    ).toBeInTheDocument();
    // The dashboard sidebar item must be the active one after the redirect.
    expect(screen.getByRole('link', { name: 'Tổng quan' })).toHaveAttribute('aria-current', 'page');
  });

  it('keeps the demo tree behind authentication', async () => {
    authState.isAuthenticated = false;
    const log: string[] = [];
    const { container } = render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/demo/dashboard']}>
          <LocationProbe log={log} />
          <AppRoutes />
        </MemoryRouter>
      </ToastProvider>,
    );
    // Bounced to /login and no demo placeholder ever mounts.
    await vi.waitFor(() => expect(log[0]).toBe('/login'));
    expect(container.querySelector('[data-testid="demo-placeholder-page"]')).toBeNull();
    authState.isAuthenticated = true;
  });

  it('shows the signed-in user in the shell header', async () => {
    renderDemoRoute('/demo/dashboard');
    expect(await screen.findByText('Trần Nhật Quân')).toBeInTheDocument();
    expect(screen.getByText('Quản trị viên')).toBeInTheDocument();
  });
});
