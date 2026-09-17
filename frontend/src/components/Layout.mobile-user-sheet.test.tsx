import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@tingting/shared';

const { useAuthMock, usePushMock, useBadgeCountsMock, logoutMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  usePushMock: vi.fn(),
  useBadgeCountsMock: vi.fn(),
  logoutMock: vi.fn(),
}));

vi.mock('../hooks/useAuth', () => ({ useAuth: useAuthMock }));
vi.mock('../hooks/usePushNotifications', () => ({ usePushNotifications: usePushMock }));
vi.mock('../hooks/useQueries', () => ({ useBadgeCounts: useBadgeCountsMock }));

import Layout from './Layout';
import { MonthProvider } from '../hooks/useMonth';
import { SearchProvider } from '../context/SearchContext';

// jsdom implements no matchMedia; Layout's mobile viewport branch (which owns
// the bottom nav and the driver account sheet) keys off a max-width query.
beforeAll(() => {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes('max-width'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: () => false,
    }),
  });
});

function CurrentRoute() {
  const location = useLocation();
  return <output aria-label="Đường dẫn hiện tại">{location.pathname}</output>;
}

function renderDriverShell() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/my-trips']}>
        <MonthProvider>
          <SearchProvider>
            <Routes>
              <Route path="*" element={<Layout><div>Nội dung trang</div><CurrentRoute /></Layout>} />
            </Routes>
          </SearchProvider>
        </MonthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function openAccountSheet(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: 'Tài khoản' }));
  const overlay = document.querySelector('.mobile-user-sheet-overlay');
  expect(overlay).toBeTruthy();
  return overlay as HTMLElement;
}

describe('Layout — driver mobile account sheet vs the global dropdown-dismiss layer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePushMock.mockReturnValue({
      isSupported: false,
      isSubscribed: false,
      permissionStatus: 'denied',
      subscribe: vi.fn(),
    });
    useBadgeCountsMock.mockReturnValue({ data: null });
    useAuthMock.mockReturnValue({
      user: { userId: 9, username: 'dvthuc', fullName: 'Dương Văn Thực', role: Role.DRIVER },
      logout: logoutMock,
      isAuthenticated: true,
      loading: false,
      sessionExpired: false,
    });
  });

  it('keeps four primary tabs and opens notifications from the account sheet', async () => {
    renderDriverShell();
    const navigation = screen.getByRole('navigation', { name: 'Điều hướng chính' });
    expect(within(navigation).getAllByRole('button').map(button => button.textContent)).toEqual([
      'Hành trình', 'Thu nhập', 'Kỷ luật', 'Tài khoản',
    ]);
    openAccountSheet();
    const dialog = screen.getByRole('dialog', { name: 'Tài khoản' });
    const notifications = within(dialog).getByRole('button', { name: 'Thông báo' });
    fireEvent.pointerDown(notifications);
    fireEvent.mouseDown(notifications);
    expect(screen.getByRole('dialog', { name: 'Tài khoản' })).toBeTruthy();
    fireEvent.mouseUp(notifications);
    fireEvent.click(notifications);
    await waitFor(() => expect(screen.getByLabelText('Đường dẫn hiện tại').textContent).toBe('/notifications'));
    expect(screen.queryByRole('dialog', { name: 'Tài khoản' })).toBeNull();
    expect(document.querySelector('.app-main')?.hasAttribute('inert')).toBe(false);
    expect(within(navigation).getAllByRole('button')).toHaveLength(4);
    expect(within(navigation).getByRole('button', { name: 'Tài khoản' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('logs out when the sheet Đăng xuất button receives a full press sequence', () => {
    renderDriverShell();
    openAccountSheet();
    const button = document.querySelector(
      '.mobile-user-sheet-overlay .mobile-user-sheet-btn.danger',
    ) as HTMLElement;
    expect(button).toBeTruthy();

    // Real pointers press BEFORE they click: the document-level dismiss
    // layer listens on pointerdown/mousedown and closes unmarked menus on
    // press. If it closes this sheet mid-press the button unmounts, the
    // mouseup lands on the page beneath, no click is ever generated and the
    // tap silently does nothing — so the sheet must survive the press.
    fireEvent.pointerDown(button);
    fireEvent.mouseDown(button);
    expect(document.querySelector('.mobile-user-sheet-overlay')).toBeTruthy();
    fireEvent.mouseUp(button);
    fireEvent.click(button);

    expect(logoutMock).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.mobile-user-sheet-overlay')).toBeNull();
  });

  it('still dismisses the sheet without logging out when the press lands on the overlay', () => {
    renderDriverShell();
    const overlay = openAccountSheet();

    fireEvent.pointerDown(overlay);
    fireEvent.mouseDown(overlay);
    fireEvent.click(overlay);

    expect(logoutMock).not.toHaveBeenCalled();
    expect(document.querySelector('.mobile-user-sheet-overlay')).toBeNull();
  });

  it('announces the current route and account dialog, traps focus, and returns it on Escape', async () => {
    renderDriverShell();
    const account = screen.getByRole('button', { name: 'Tài khoản' });
    const journey = screen.getByRole('button', { name: 'Hành trình' });
    expect(journey.getAttribute('aria-current')).toBe('page');
    expect(account.getAttribute('aria-expanded')).toBe('false');

    account.focus();
    openAccountSheet();
    const dialog = screen.getByRole('dialog', { name: 'Tài khoản' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(account.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('.app-main')?.hasAttribute('inert')).toBe(true);
    const close = within(dialog).getByRole('button', { name: 'Đóng tài khoản' });
    const logout = within(dialog).getByRole('button', { name: 'Đăng xuất' });
    expect(document.activeElement).toBe(close);

    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(logout);
    fireEvent.keyDown(logout, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Tài khoản' })).toBeNull();
    expect(document.querySelector('.app-main')?.hasAttribute('inert')).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(account));
  });

  it('opens the profile action immediately without a duplicate sidebar menu', async () => {
    renderDriverShell();
    openAccountSheet();
    expect(document.querySelector('.sidebar-user-dropdown')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Thông tin cá nhân' }));
    expect(screen.queryByRole('dialog', { name: 'Tài khoản' })).toBeNull();
    expect(await screen.findByRole('dialog', { name: 'Thông tin cá nhân' })).toBeTruthy();
  });

  it.each(['Thông tin cá nhân', 'Đổi mật khẩu'])('returns focus to the account trigger after closing %s', async (title) => {
    renderDriverShell();
    const account = screen.getByRole('button', { name: 'Tài khoản' });
    account.focus();
    openAccountSheet();
    fireEvent.click(screen.getByRole('button', { name: title }));
    const dialog = await screen.findByRole('dialog', { name: title });
    expect(document.querySelector('.mobile-user-sheet-overlay')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hủy' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: title })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(account));
  });

  it('renders only the desktop account menu at a desktop viewport', () => {
    const media = vi.spyOn(window, 'matchMedia').mockImplementation(query => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: () => false,
    }));
    renderDriverShell();
    const sidebar = document.querySelector('.sidebar') as HTMLElement;
    fireEvent.click(within(sidebar).getByRole('button', { name: 'Thông báo' }));
    expect(screen.getByLabelText('Đường dẫn hiện tại').textContent).toBe('/notifications');
    fireEvent.click(screen.getByRole('button', { name: 'Menu người dùng' }));
    expect(document.querySelector('.sidebar-user-dropdown')).toBeTruthy();
    expect(document.querySelector('.mobile-user-sheet-overlay')).toBeNull();
    media.mockRestore();
  });
});
