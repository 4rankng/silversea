import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@tingting/shared';

const { authState } = vi.hoisted(() => ({
  authState: {
    role: 'ADMIN' as Role,
  },
}));

vi.mock('./hooks/useAuth', async () => {
  const actual = await vi.importActual<typeof import('./hooks/useAuth')>('./hooks/useAuth');
  return {
    ...actual,
    useAuth: () => ({
      user: {
        userId: 17,
        username: authState.role === Role.MANAGER ? 'giamdoc' : authState.role === Role.ACCOUNTANT ? 'ketoan' : 'tester',
        email: null,
        phone: null,
        role: authState.role,
        fullName: 'Người kiểm thử',
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

vi.mock('./pages/config/CompanyInfoConfigPage', () => ({
  default: () => <div>Company info test page</div>,
}));

vi.mock('./pages/DriverTripsPage', () => ({
  default: () => <div>Driver home test page</div>,
}));

import { AppRoutes } from './App';

function renderRoute() {
  return render(
    <MemoryRouter initialEntries={['/config/company-info']}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

describe('AppRoutes company-info RBAC', () => {
  beforeEach(() => {
    authState.role = Role.ADMIN;
  });

  it.each([Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT])('admits office role %s', async (role) => {
    authState.role = role;
    renderRoute();

    expect(await screen.findByText('Company info test page')).toBeTruthy();
    expect(screen.getByTestId('layout-shell')).toBeTruthy();
  });

  it('redirects DRIVER away from company configuration', async () => {
    authState.role = Role.DRIVER;
    renderRoute();

    expect(await screen.findByText('Driver home test page')).toBeTruthy();
    expect(screen.queryByText('Company info test page')).toBeNull();
  });
});
