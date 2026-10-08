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

// Card 061026172806 — QA retest reported OPS being bounced off /fleet and
// /expenses back to /my-orders. That is NOT a defect: it is the designed
// authorization, agreed by three independent layers.
//
//   1. Nav      — the OPS menu (Layout.tsx) deliberately omits "Đội xe" and
//                 "Chi phí phát sinh", and ships its own read-only
//                 "Theo dõi phương tiện" (/ops/fleet-tracking) instead.
//   2. Route    — /fleet uses officeStaffOnly (ADMIN|MANAGER|ACCOUNTANT) and
//                 /expenses uses financeReaderOnly (same trio); OPS is out of
//                 both, so it is sent to its own home.
//   3. Backend  — backend/src/casbin/policy.csv grants OPS no fleet/expenses
//                 resource at all (operations_portal, trips, dispatch, maps,
//                 photos, notifications, geotag, recoverable_costs only), and
//                 OpsVanHanh §2/§66 scopes Ops expense entry to its own
//                 assigned lots.
//
// These tests pin that contract so the next QA sweep does not re-file it as a
// bug, and so a future grant to OPS has to change a test on purpose.
describe('AppRoutes Ops is deliberately outside the office-only fleet and expense screens', () => {
  it.each([
    { path: '/fleet', reason: 'office fleet workspace' },
    { path: '/expenses', reason: 'company-wide expense list' },
  ])('redirects OPS away from $path ($reason)', async ({ path }) => {
    renderRoute(path);
    expect(await screen.findByText('Ops order workspace')).toBeTruthy();
  });
});
