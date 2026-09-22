import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
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

vi.mock('./pages/ShipmentContainersPage', () => ({
  default: () => <div>Shipment containers test page</div>,
}));

vi.mock('./pages/ShipmentDebitPage', () => ({ default: () => <div>Shipment settlement test page</div> }));
vi.mock('./pages/MasterPlanPage', () => ({ default: () => <div>Dispatch home test page</div> }));

vi.mock('./pages/ShipmentsPage', () => ({
  default: () => <div>Shipment overview test page</div>,
}));

vi.mock('./pages/DashboardPage', () => ({
  default: () => <div>Dashboard test page</div>,
}));

vi.mock('./pages/AccountingWorkspacePage', () => ({
  default: () => <div>Accounting test page</div>,
}));

import { AppRoutes } from './App';

function renderRoute(path: string) {
  function LocationProbe() {
    const location = useLocation();
    return <span data-testid="route-location">{location.pathname}</span>;
  }
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe('AppRoutes shipment operations reachability', () => {
  beforeEach(() => {
    authState.role = Role.MANAGER;
  });

  it('redirects dispatcher away from settlement data that its API rejects', async () => {
    authState.role = Role.DISPATCHER;
    renderRoute('/shipments-debit');
    await vi.waitFor(() => expect(screen.getByTestId('route-location').textContent).toBe('/dispatch'));
    expect(screen.queryByText('Shipment settlement test page')).toBeNull();
  });

  it.each([Role.ADMIN, Role.ACCOUNTANT, Role.CUS, Role.MANAGER])('admits %s to settlement summaries', async (role) => {
    authState.role = role;
    renderRoute('/shipments-debit');
    expect(await screen.findByText('Shipment settlement test page')).toBeTruthy();
  });

  it('admits MANAGER to the shipment create route', async () => {
    renderRoute('/shipments/new');
    expect(await screen.findByText('Shipment create test page')).toBeTruthy();
  });

  it('redirects the removed dossier URL to the CUS shipment overview', async () => {
    authState.role = Role.CUS;
    renderRoute('/clerk/shipments/42/docs');
    expect(await screen.findByText('Shipment overview test page')).toBeTruthy();
    expect(screen.getByTestId('route-location').textContent).toBe('/shipments');
  });

  it('keeps ACCOUNTANT out of shipment write routes', async () => {
    authState.role = Role.ACCOUNTANT;
    renderRoute('/shipments/new');
    expect(await screen.findByText('Accounting test page')).toBeTruthy();
    expect(screen.queryByText('Shipment create test page')).toBeNull();
  });

  it.each([
    [Role.ADMIN, '/shipments/new'],
    [Role.CUS, '/shipments/new'],
    [Role.MANAGER, '/shipments/new'],
  ])('admits %s to %s', async (role, path) => {
    authState.role = role;
    renderRoute(path);
    expect(await screen.findByText('Shipment create test page')).toBeTruthy();
    expect(screen.getByTestId('route-location').textContent).toBe(path);
  });

  it.each([
    [Role.ADMIN, '/shipments-detail'],
    [Role.CUS, '/shipments-detail'],
    [Role.MANAGER, '/shipments-detail'],
    [Role.ACCOUNTANT, '/shipments-detail'],
    [Role.DISPATCHER, '/shipments-detail'],
  ])('admits %s to the container-flat view %s', async (role, path) => {
    authState.role = role;
    renderRoute(path);
    expect(await screen.findByText('Shipment containers test page')).toBeTruthy();
    expect(screen.getByTestId('route-location').textContent).toBe(path);
  });

  it.each([
    [Role.DRIVER, '/shipments-detail'],
    [Role.OPS, '/shipments-detail'],
    [Role.CUSTOMER, '/shipments-detail'],
  ])('redirects %s away from the container-flat view %s', async (role, path) => {
    authState.role = role;
    renderRoute(path);
    await screen.findByTestId('route-location');
    await vi.waitFor(() => expect(screen.getByTestId('route-location').textContent).not.toBe(path));
    expect(screen.queryByText('Shipment containers test page')).toBeNull();
  });

  it.each([
    [Role.ADMIN, '/clerk/shipments/new'],
    [Role.CUS, '/clerk/shipments/new'],
    [Role.MANAGER, '/clerk/shipments/new'],
    [Role.ACCOUNTANT, '/shipments/new'],
    [Role.DRIVER, '/shipments/new'],
    [Role.OPS, '/shipments/new'],
    [Role.CUSTOMER, '/shipments/new'],
  ])('redirects %s away from %s', async (role, path) => {
    authState.role = role;
    renderRoute(path);
    await screen.findByTestId('route-location');
    await vi.waitFor(() => expect(screen.getByTestId('route-location').textContent).not.toBe(path));
    expect(screen.queryByText('Shipment create test page')).toBeNull();
  });

  it('allows DISPATCHER to create a shipment', async () => {
    authState.role = Role.DISPATCHER;
    renderRoute('/shipments/new');
    expect(await screen.findByText('Shipment create test page')).toBeTruthy();
  });
});
