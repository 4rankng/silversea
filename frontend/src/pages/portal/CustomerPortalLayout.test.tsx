import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Role } from '@tingting/shared';

const { useAuthMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
}));

vi.mock('../../hooks/useAuth', () => ({
  useAuth: useAuthMock,
}));

import CustomerPortalLayout from './CustomerPortalLayout';

describe('CustomerPortalLayout', () => {
  beforeEach(() => {
    useAuthMock.mockReset();
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
});
