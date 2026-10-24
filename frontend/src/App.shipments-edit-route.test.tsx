import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@tingting/shared';

const { authState } = vi.hoisted(() => ({ authState: { role: 'DISPATCHER' as Role } }));

vi.mock('./hooks/useAuth', async () => {
  const actual = await vi.importActual<typeof import('./hooks/useAuth')>('./hooks/useAuth');
  return {
    ...actual,
    useAuth: () => ({
      user: {
        userId: 42, username: 'dungnv', email: null, phone: null,
        role: authState.role, fullName: 'Điều vận', capabilities: [],
      },
      logout: vi.fn(), login: vi.fn(), updateUser: vi.fn(),
      isAuthenticated: true, loading: false, sessionExpired: false,
    }),
  };
});

vi.mock('./components/Layout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout-shell">{children}</div>,
}));

const detailRendered = vi.hoisted(() => ({ props: null as { id?: string } | null }));
vi.mock('./pages/ShipmentDetailPage', () => ({
  default: (props: { id?: string }) => {
    detailRendered.props = props;
    return <div>shipment detail surface</div>;
  },
}));

// SIL-171: /shipments/:id/edit is the REAL edit form now — mock it so this
// route test observes wiring only, not the workspace's own fetches.
const editRendered = vi.hoisted(() => ({ count: 0 }));
vi.mock('./pages/clerk/ClerkShipmentEditPage', () => ({
  default: () => {
    editRendered.count += 1;
    return <div>shipment edit form surface</div>;
  },
}));

import { AppRoutes } from './App';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="loc">{location.pathname}</div>;
}

function renderRoute(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
      <LocationProbe />
    </MemoryRouter>,
  );
}

// Card 20261004_358 criterion 2 said "no 404 for guessed edit URLs"; SIL-171
// (FB-147, 24/10) upgrades the alias to the real edit surface. The contract
// that survives: the URL never dead-ends.
describe('AppRoutes /shipments/:id/edit — SIL-171 real edit form', () => {
  beforeEach(() => {
    authState.role = Role.DISPATCHER;
    detailRendered.props = null;
    editRendered.count = 0;
  });

  it('lands a guessed edit URL on the shipment EDIT FORM instead of the 404', async () => {
    renderRoute('/shipments/315/edit');
    expect(await screen.findByText('shipment edit form surface')).toBeTruthy();
    expect(screen.queryByText(/Trang bạn tìm|Không tìm thấy|404/)).toBeNull();
    // The URL stays put — no redirect to the detail page.
    expect(screen.getByTestId('loc').textContent).toBe('/shipments/315/edit');
  });

  it('keeps the plain detail route untouched', async () => {
    renderRoute('/shipments/315');
    expect(await screen.findByText('shipment detail surface')).toBeTruthy();
    expect(screen.getByTestId('loc').textContent).toBe('/shipments/315');
    expect(editRendered.count).toBe(0);
  });
});
