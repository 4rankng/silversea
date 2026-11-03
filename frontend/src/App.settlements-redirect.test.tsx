// SIL-676 — the bare /settlements path must route each role to its REAL
// settlements surface (QA hit the SPA 404 + GET /api/settlements 404; the
// backend now aliases that API, the SPA redirects). Harness mirrors
// App.accounting-routes.test.tsx (useAuth role mock + lazy page mocks).
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@tingting/shared';

const { authState } = vi.hoisted(() => ({ authState: { role: 'OPS' as Role } }));

vi.mock('./hooks/useAuth', async () => {
  const actual = await vi.importActual<typeof useAuthModule>('./hooks/useAuth');
  return {
    ...actual,
    useAuth: () => ({
      user: {
        userId: 3, username: 'giaonhan', email: null, phone: null,
        role: authState.role, fullName: 'Giao nhận', capabilities: [],
      },
      logout: vi.fn(), login: vi.fn(), updateUser: vi.fn(),
      isAuthenticated: true, loading: false, sessionExpired: false,
    }),
  };
});

vi.mock('./components/Layout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout-shell">{children}</div>,
}));
vi.mock('./pages/OpsWalletPage', () => ({ default: () => <div>Ops wallet settlements</div> }));
vi.mock('./pages/ShipmentDebitPage', () => ({ default: () => <div>CUS settlement workspace</div> }));
vi.mock('./pages/driver/DriverPayslipsPage', () => ({ default: () => <div>Driver payslips</div> }));
vi.mock('./pages/MasterPlanPage', () => ({ default: () => <div>Dispatch home</div> }));
vi.mock('./pages/portal/PortalShipmentsPage', () => ({ default: () => <div>Portal shipments</div> }));
vi.mock('./pages/AdvanceWorkspacePage', () => ({ default: () => <div>Settlement authority</div> }));

import { ToastProvider } from './components/shared/Toast';
import { AppRoutes, settlementsRedirectTarget } from './App';
import type * as useAuthModule from './hooks/useAuth';

function renderRoute(path: string) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter>
    </ToastProvider>,
  );
}

describe('SIL-676 — /settlements redirects each role to its existing surface', () => {
  beforeEach(() => { authState.role = Role.OPS; });

  it.each([
    [Role.OPS, 'Ops wallet settlements'],
    [Role.CUS, 'CUS settlement workspace'],
    [Role.DRIVER, 'Driver payslips'],
    [Role.DISPATCHER, 'Dispatch home'],
    [Role.CUSTOMER, 'Portal shipments'],
    [Role.ACCOUNTANT, 'Settlement authority'],
    [Role.ADMIN, 'Settlement authority'],
    [Role.MANAGER, 'Settlement authority'],
  ])('%s lands on its settlements surface', async (role, expected) => {
    authState.role = role;
    renderRoute('/settlements');
    expect(await screen.findByText(expected)).toBeTruthy();
  });

  it('maps the office trio onto the advances settlements view and ops onto the wallet', () => {
    expect(settlementsRedirectTarget(Role.OPS)).toBe('/ops/wallet');
    expect(settlementsRedirectTarget(Role.CUS)).toBe('/shipments-debit');
    expect(settlementsRedirectTarget(Role.DRIVER)).toBe('/my-payslips');
    expect(settlementsRedirectTarget(Role.DISPATCHER)).toBe('/dispatch');
    expect(settlementsRedirectTarget(Role.CUSTOMER)).toBe('/portal/shipments');
    expect(settlementsRedirectTarget(Role.ADMIN)).toBe('/advances?view=settlements');
    expect(settlementsRedirectTarget(Role.ACCOUNTANT)).toBe('/advances?view=settlements');
    expect(settlementsRedirectTarget(Role.MANAGER)).toBe('/advances?view=settlements');
  });
});
