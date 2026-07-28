import { Suspense, type ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, MemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { useAuthMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
}));

vi.mock('./hooks/useAuth', async () => {
  const actual = await vi.importActual<typeof import('./hooks/useAuth')>('./hooks/useAuth');
  return {
    ...actual,
    useAuth: useAuthMock,
  };
});

vi.mock('./pages/LoginPage', () => ({
  default: () => <div>Đăng nhập</div>,
}));

vi.mock('./pages/DashboardPage', () => ({
  default: () => <div>Tổng quan</div>,
}));

vi.mock('./components/Layout', () => ({
  default: ({ children }: { children: ReactNode }) => {
    const { logout } = useAuthMock();
    return (
      <div>
        <button type="button" onClick={logout}>Đăng xuất từ khung ứng dụng</button>
        {children}
      </div>
    );
  },
}));

import { AppRoutes } from './App';

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

describe('unauthenticated route handling', () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    useAuthMock.mockReturnValue({
      isAuthenticated: false,
      user: null,
      loading: false,
    });
  });

  it('replaces a protected route with the login route after logout', async () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Suspense>
          <AppRoutes />
        </Suspense>
        <LocationProbe />
      </MemoryRouter>,
    );

    expect((await screen.findByTestId('location')).textContent).toBe('/login');
    expect(await screen.findByText('Đăng nhập')).toBeTruthy();
  });

  it('renders the login page without redirecting when already on the login route', async () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <Suspense>
          <AppRoutes />
        </Suspense>
        <LocationProbe />
      </MemoryRouter>,
    );

    expect((await screen.findByTestId('location')).textContent).toBe('/login');
    expect(await screen.findByText('Đăng nhập')).toBeTruthy();
  });

  it('replaces the protected history entry after an authenticated shell logout', async () => {
    let authenticated = true;
    let router: ReturnType<typeof createMemoryRouter>;
    const logout = vi.fn(() => {
      authenticated = false;
      void router.navigate(router.state.location.pathname, { replace: true });
    });
    useAuthMock.mockImplementation(() => ({
      isAuthenticated: authenticated,
      user: authenticated ? { userId: 1, role: 'ADMIN' } : null,
      loading: false,
      logout,
    }));

    router = createMemoryRouter(
      [{ path: '*', element: <AppRoutes /> }],
      { initialEntries: ['/sentinel', '/dashboard'], initialIndex: 1 },
    );
    render(<RouterProvider router={router} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Đăng xuất từ khung ứng dụng' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.historyAction).toBe('REPLACE');
    expect(logout).toHaveBeenCalledOnce();
    expect(await screen.findByText('Đăng nhập')).toBeTruthy();
  });
});
