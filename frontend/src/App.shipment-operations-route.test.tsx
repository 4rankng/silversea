import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@tingting/shared';

const { authState } = vi.hoisted(() => ({
  authState: { role: 'MANAGER' as string },
}));

vi.mock('./hooks/useAuth', async () => {
  const actual = await vi.importActual<typeof import('./hooks/useAuth')>('./hooks/useAuth');
  return {
    ...actual,
    useAuth: () => ({
      user: {
        userId: 17,
        username: 'tester',
        email: null,
        phone: null,
        role: authState.role as Role,
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

vi.mock('./pages/clerk/ClerkShipmentCreatePage', () => ({
  default: () => <div>Shipment create test page</div>,
}));

vi.mock('./pages/clerk/ClerkShipmentDocsPage', () => ({
  default: () => <div>Shipment dossier test page</div>,
}));

vi.mock('./pages/DashboardPage', () => ({
  default: () => <div>Dashboard test page</div>,
}));

import { AppRoutes } from './App';

function renderRoute(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

describe('AppRoutes shipment operations reachability', () => {
  beforeEach(() => {
    authState.role = Role.MANAGER;
  });

  it('admits MANAGER to create and dossier routes', async () => {
    const createView = renderRoute('/shipments/new');
    expect(await screen.findByText('Shipment create test page')).toBeTruthy();
    createView.unmount();

    renderRoute('/clerk/shipments/42/docs');
    expect(await screen.findByText('Shipment dossier test page')).toBeTruthy();
  });

  it('keeps ACCOUNTANT out of shipment write routes', async () => {
    authState.role = Role.ACCOUNTANT;
    renderRoute('/shipments/new');
    expect(await screen.findByText('Dashboard test page')).toBeTruthy();
    expect(screen.queryByText('Shipment create test page')).toBeNull();
  });
});
