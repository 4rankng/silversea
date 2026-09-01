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
        userId: 5,
        username: 'dieuvan',
        email: null,
        phone: null,
        role: 'DISPATCHER' as Role,
        fullName: 'Điều vận',
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
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('./pages/TripListPage', () => ({ default: () => <div data-testid="trip-list-page">Sổ chuyến đi</div> }));
vi.mock('./pages/MasterPlanPage', () => ({ default: () => <div data-testid="dispatch-master-plan">Kế hoạch tổng quát</div> }));

import { AppRoutes } from './App';

describe('AppRoutes DISPATCHER trips access', () => {
  it('bounces DISPATCHER off /trips to their dispatch home (user 2026-09-01: role never meant to have it)', async () => {
    render(
      <MemoryRouter initialEntries={['/trips']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('trip-list-page')).toBeNull();
    expect(await screen.findByTestId('dispatch-master-plan')).toBeTruthy();
  });

  it('keeps the dispatcher dispatch surfaces reachable', () => {
    render(
      <MemoryRouter initialEntries={['/dispatch']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('dispatch-master-plan')).toBeTruthy();
  });
});
