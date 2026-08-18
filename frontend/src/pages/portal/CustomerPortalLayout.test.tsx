import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Role } from '@tingting/shared';

const { useAuthMock, apiGet } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  apiGet: vi.fn(),
}));

vi.mock('../../hooks/useAuth', () => ({
  useAuth: useAuthMock,
}));

vi.mock('../../lib/api', () => ({
  api: { get: apiGet },
}));

import CustomerPortalLayout from './CustomerPortalLayout';
import { useCustomerPortalScope } from './CustomerPortalScope';

function ScopeProbe() {
  const { selectedCustomerId } = useCustomerPortalScope();
  const location = useLocation();
  return (
    <>
      <div>Selected customer: {selectedCustomerId ?? 'none'}</div>
      <div>Portal query: {location.search || 'none'}</div>
    </>
  );
}

describe('CustomerPortalLayout', () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    apiGet.mockReset();
    apiGet.mockResolvedValue({
      primaryCustomerId: 7,
      customers: [{ id: 7, name: 'SilverSea Miền Nam' }],
    });
    useAuthMock.mockReturnValue({
      user: {
        userId: 7,
        username: 'portal-user',
        email: 'portal-user@example.com',
        phone: null,
        role: Role.CUSTOMER,
        fullName: 'Portal User',
      },
      logout: vi.fn(),
      login: vi.fn(),
      updateUser: vi.fn(),
      isAuthenticated: true,
      loading: false,
      sessionExpired: false,
    });
  });

  it('opens the mobile account menu and redirects to /login on logout', () => {
    const logout = vi.fn();
    useAuthMock.mockReturnValue({
      user: {
        userId: 7,
        username: 'portal-user',
        email: 'portal-user@example.com',
        phone: null,
        role: Role.CUSTOMER,
        fullName: 'Portal User',
      },
      logout,
      login: vi.fn(),
      updateUser: vi.fn(),
      isAuthenticated: true,
      loading: false,
      sessionExpired: false,
    });

    render(
      <MemoryRouter initialEntries={['/portal/shipments']}>
        <Routes>
          <Route
            path="/portal/shipments"
            element={(
              <CustomerPortalLayout>
                <div>Portal body</div>
              </CustomerPortalLayout>
            )}
          />
          <Route path="/login" element={<div>Login page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Mở menu tài khoản' }));
    expect(screen.getByText('portal-user@example.com')).toBeTruthy();

    const popover = screen.getByText('portal-user@example.com').closest('.customer-shell__account-popover');
    expect(popover).toBeTruthy();
    fireEvent.click(within(popover as HTMLElement).getByRole('button', { name: 'Đăng xuất' }));

    expect(logout).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Login page')).toBeTruthy();
  });

  it('connects the account trigger to its popover and restores focus on Escape', async () => {
    render(
      <MemoryRouter>
        <CustomerPortalLayout>
          <div>Portal body</div>
        </CustomerPortalLayout>
      </MemoryRouter>,
    );

    const trigger = screen.getByRole('button', { name: 'Mở menu tài khoản' });
    expect(trigger.getAttribute('aria-controls')).toBe('customer-account-popover');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('portal-user@example.com')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('shows linked legal entities and changes the active portal scope', async () => {
    apiGet.mockResolvedValue({
      primaryCustomerId: 7,
      customers: [
        { id: 7, name: 'SilverSea Miền Nam' },
        { id: 9, name: 'SilverSea Miền Bắc' },
      ],
    });

    render(
      <MemoryRouter>
        <CustomerPortalLayout>
          <ScopeProbe />
        </CustomerPortalLayout>
      </MemoryRouter>,
    );

    const trigger = await screen.findByRole('button', { name: /Pháp nhân đang xem/ });
    expect(screen.getByText('Selected customer: 7')).toBeTruthy();

    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('option', { name: 'SilverSea Miền Bắc' }));

    expect(await screen.findByText('Selected customer: 9')).toBeTruthy();
    expect(screen.getByText('Portal query: ?customerId=9')).toBeTruthy();
    expect(screen.getByText('Dữ liệu được tách riêng theo từng pháp nhân.')).toBeTruthy();
  });

  it('restores an allowed legal entity from a shared deep link', async () => {
    apiGet.mockResolvedValue({
      primaryCustomerId: 7,
      customers: [
        { id: 7, name: 'SilverSea Miền Nam' },
        { id: 9, name: 'SilverSea Miền Bắc' },
      ],
    });

    render(
      <MemoryRouter initialEntries={['/portal/shipments?customerId=9']}>
        <CustomerPortalLayout>
          <ScopeProbe />
        </CustomerPortalLayout>
      </MemoryRouter>,
    );

    await screen.findByRole('button', { name: /Pháp nhân đang xem/ });
    expect(screen.getByText('Selected customer: 9')).toBeTruthy();
  });
});
