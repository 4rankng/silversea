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

describe('AppRoutes /shipments/:id/edit alias (card 358 criterion 2)', () => {
  beforeEach(() => {
    authState.role = Role.DISPATCHER;
    detailRendered.props = null;
  });

  it('lands a guessed edit URL on the shipment detail surface instead of the 404', async () => {
    renderRoute('/shipments/315/edit');
    expect(await screen.findByText('shipment detail surface')).toBeTruthy();
    expect(screen.queryByText(/Trang bạn tìm|Không tìm thấy|404/)).toBeNull();
    expect(screen.getByTestId('loc').textContent).toBe('/shipments/315');
  });

  it('keeps the plain detail route untouched', async () => {
    renderRoute('/shipments/315');
    expect(await screen.findByText('shipment detail surface')).toBeTruthy();
    expect(screen.getByTestId('loc').textContent).toBe('/shipments/315');
  });
});
