import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@tingting/shared';

const { authState } = vi.hoisted(() => ({ authState: { role: 'ACCOUNTANT' as Role } }));

vi.mock('./hooks/useAuth', async () => {
  const actual = await vi.importActual<typeof import('./hooks/useAuth')>('./hooks/useAuth');
  return {
    ...actual,
    useAuth: () => ({
      user: {
        userId: 17, username: 'ketoan', email: null, phone: null,
        role: authState.role, fullName: 'Kế toán', capabilities: [],
      },
      logout: vi.fn(), login: vi.fn(), updateUser: vi.fn(),
      isAuthenticated: true, loading: false, sessionExpired: false,
    }),
  };
});

vi.mock('./components/Layout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout-shell">{children}</div>,
}));
vi.mock('./pages/DebtListPage', () => ({ default: () => <div>Debt list authority</div> }));
vi.mock('./pages/DebtDetailPage', () => ({ default: () => <div>Debt detail authority</div> }));
vi.mock('./pages/AdvanceWorkspacePage', () => ({ default: () => <div>Settlement authority</div> }));
vi.mock('./pages/ExpenseListPage', () => ({ default: () => <div>Expense authority</div> }));
vi.mock('./pages/PayableListPage', () => ({ default: () => <div>Payables authority</div> }));
vi.mock('./pages/PayableDetailPage', () => ({ default: () => <div>Payable detail authority</div> }));
vi.mock('./pages/FinancePage', () => ({ default: () => <div>Profit and loss authority</div> }));
vi.mock('./pages/DriverTripsPage', () => ({ default: () => <div>Driver home</div> }));

import { AppRoutes } from './App';

function renderRoute(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter>);
}

describe('AppRoutes accountant authoritative workspaces', () => {
  beforeEach(() => { authState.role = Role.ACCOUNTANT; });

  it.each([
    ['/debt', 'Debt list authority'],
    ['/debt/5', 'Debt detail authority'],
    ['/debt/5/billing/new', 'Debt detail authority'],
    ['/advances?view=settlements&tripId=10', 'Settlement authority'],
    ['/expenses?tripId=10', 'Expense authority'],
    ['/payables', 'Payables authority'],
    ['/payables/7', 'Payable detail authority'],
    ['/finance', 'Profit and loss authority'],
  ])('admits ACCOUNTANT to %s', async (path, expected) => {
    renderRoute(path);
    expect(await screen.findByText(expected)).toBeTruthy();
    expect(screen.getByTestId('layout-shell')).toBeTruthy();
  });

  it('keeps DRIVER out of the financial workspaces', async () => {
    authState.role = Role.DRIVER;
    renderRoute('/expenses?tripId=10');
    expect(await screen.findByText('Driver home')).toBeTruthy();
    expect(screen.queryByText('Expense authority')).toBeNull();
  });
});
