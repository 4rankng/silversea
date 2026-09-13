import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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
              <Route path="*" element={<Layout><div>Nội dung trang</div></Layout>} />
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
});
