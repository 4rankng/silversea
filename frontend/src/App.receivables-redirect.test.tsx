// Card 071026211120 — /receivables is the name the spec and the reports kept
// using for the receivables page, but the route has always been /debt, so the
// documented link was a hard 404 ("Không tìm thấy trang") for a signed-in
// accountant. Redirect the legacy path instead of letting the catch-all eat it.
//
// The redirect must land on the REAL page under its own access guard, so an
// unauthorized role is still bounced by /debt rather than gaining a way in.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@tingting/shared';

const { useAuthMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
}));

vi.mock('./hooks/useAuth', async () => {
  const actual = await vi.importActual<typeof import('./hooks/useAuth')>('./hooks/useAuth');
  return { ...actual, useAuth: useAuthMock };
});

vi.mock('./components/Layout', async () => {
  const actual = await vi.importActual<typeof import('./components/Layout')>('./components/Layout');
  return {
    ...actual,
    default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout-shell">{children}</div>,
  };
});

vi.mock('./pages/DebtListPage', () => ({
  default: () => <div>Debt list test page</div>,
}));

import { AppRoutes } from './App';

function authAs(role: Role) {
  useAuthMock.mockReturnValue({
    user: {
      userId: 17,
      username: 'ketoan',
      email: 'ketoan@example.com',
      phone: null,
      role,
      fullName: 'Kế toán',
    },
    logout: vi.fn(),
    login: vi.fn(),
    updateUser: vi.fn(),
    isAuthenticated: true,
    loading: false,
    sessionExpired: false,
  });
}

describe('AppRoutes legacy /receivables', () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    authAs(Role.ACCOUNTANT);
  });

  it('sends /receivables to the receivables page instead of the 404 (card 071026211120)', async () => {
    render(
      <MemoryRouter initialEntries={['/receivables']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Debt list test page')).toBeTruthy();
    expect(screen.queryByText(/Không tìm thấy trang/)).toBeNull();
  });

  it('keeps the redirect behind the page\'s own access guard — a DRIVER gets bounced, not shown receivables', async () => {
    authAs(Role.DRIVER);
    render(
      <MemoryRouter initialEntries={['/receivables']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    expect(screen.queryByText('Debt list test page')).toBeNull();
  });
});