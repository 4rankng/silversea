import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { Role } from '@tingting/shared';

vi.mock('./hooks/useAuth', async () => {
  const actual = await vi.importActual<typeof import('./hooks/useAuth')>('./hooks/useAuth');
  return {
    ...actual,
    useAuth: () => ({
      user: {
        userId: 9,
        username: 'giaonhan',
        email: null,
        phone: null,
        role: 'FORWARDER' as Role,
        fullName: 'Nhân viên vận hành',
      },
      logout: vi.fn(),
      login: vi.fn(),
      updateUser: vi.fn(),
      isAuthenticated: true,
      loading: false,
      sessionExpired: false,
    }),
  };
});

vi.mock('./components/Layout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout-shell">{children}</div>,
}));

vi.mock('./pages/ForwarderTripsPage', () => ({
  default: () => <div>Ops order workspace</div>,
}));

import { AppRoutes } from './App';

function renderRoute(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

describe('AppRoutes legacy FORWARDER compatibility', () => {
  it.each(['/', '/my-orders'])('renders the canonical Ops workspace at %s', async (path) => {
    renderRoute(path);
    expect(await screen.findByText('Ops order workspace')).toBeTruthy();
    expect(screen.getByTestId('layout-shell')).toBeTruthy();
  });

  it('redirects a legacy FORWARDER away from an office-only customer page', async () => {
    renderRoute('/customers/1');
    expect(await screen.findByText('Ops order workspace')).toBeTruthy();
  });
});
