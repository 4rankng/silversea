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

vi.mock('./pages/AccountingWorkspacePage', () => ({
  default: () => <div>Không gian kế toán</div>,
}));

vi.mock('./pages/DriverTripsPage', () => ({ default: () => <div>Hành trình lái xe</div> }));

vi.mock('./components/Layout', () => {
  const MockLayout = ({ children }: { children: ReactNode }) => {
    const { logout } = useAuthMock();
    return (
      <div>
        <button type="button" onClick={logout}>Đăng xuất từ khung ứng dụng</button>
        {children}
      </div>
    );
  };
  return { default: MockLayout };
});

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

  it('takes a newly authenticated driver from login to their own home instead of 404', async () => {
    useAuthMock.mockReturnValue({ isAuthenticated: true, user: { userId: 2, role: 'DRIVER' }, loading: false, logout: vi.fn() });
    render(<MemoryRouter initialEntries={['/login']}><Suspense><AppRoutes /></Suspense><LocationProbe /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/my-trips'));
    expect(screen.queryByText('Không tìm thấy trang')).not.toBeInTheDocument();
  });

  it('explains genuine unknown addresses without silently discarding the requested URL', async () => {
    useAuthMock.mockReturnValue({ isAuthenticated: true, user: { userId: 1, role: 'ADMIN' }, loading: false, logout: vi.fn() });
    render(<MemoryRouter initialEntries={['/unknown-page']}><Suspense><AppRoutes /></Suspense><LocationProbe /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Không tìm thấy trang' })).toBeVisible();
    expect(screen.getByTestId('location')).toHaveTextContent('/unknown-page');
  });

  it('redirects an accountant without executive dashboard access to the accounting home', async () => {
    useAuthMock.mockReturnValue({
      isAuthenticated: true,
      user: {
        userId: 3,
        role: 'ACCOUNTANT',
        capabilities: [],
      },
      loading: false,
      logout: vi.fn(),
    });

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Suspense>
          <AppRoutes />
        </Suspense>
        <LocationProbe />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/accounting'));
    expect(await screen.findByText('Không gian kế toán')).toBeTruthy();
  });

  it('replaces the protected history entry after an authenticated shell logout', async () => {
    let authenticated = true;
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

    const router = createMemoryRouter(
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
