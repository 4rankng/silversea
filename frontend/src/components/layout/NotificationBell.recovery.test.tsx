import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { NotificationBell } from './NotificationBell';

const { refetch } = vi.hoisted(() => ({ refetch: vi.fn() }));
/** Re-pointable per-test notification feed; see mockFeed below. */
const { feed } = vi.hoisted(() => ({ feed: { current: undefined as unknown } }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { role: 'ADMIN' } }) }));
vi.mock('../../hooks/usePushNotifications', () => ({ usePushNotifications: () => ({ isSupported: false }) }));
vi.mock('../../hooks/useNotificationQueries', () => ({
  useUnreadCount: () => ({ data: undefined }),
  useNotifications: () => ({ data: undefined, isError: true, isLoading: false, isFetching: false, refetch }),
  useMarkAllAsRead: () => ({ mutate: vi.fn() }),
  useMarkAsRead: () => ({ mutate: vi.fn() }),
}));

it('offers retry without claiming an unavailable notification feed is empty', () => {
  render(<MemoryRouter><NotificationBell /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'Thông báo' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Không tải được thông báo');
  expect(screen.queryByText('Không có thông báo')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  expect(refetch).toHaveBeenCalledOnce();
});

/**
 * Card 051026231511 — the bell's quick fund notice. The bell is a generic
 * renderer, so this pins the one thing that could go wrong at this layer: that
 * a FUND_NEGATIVE row actually surfaces with its Vietnamese title and BOTH fund
 * balances, and that the panel does not imply the fund is fine when there is no
 * such row.
 */
describe('NotificationBell — quỹ âm notice (card 051026231511)', () => {
  function mockFeed(items: unknown[] | undefined) {
    feed.current = { items, page: 1, limit: 20, total: items?.length ?? 0 };
    vi.doMock('../../hooks/useNotificationQueries', () => ({
      useUnreadCount: () => ({ data: { count: items?.length ?? 0 } }),
      useNotifications: () => ({
        data: feed.current, isError: false, isLoading: false, isFetching: false, refetch,
      }),
      useMarkAllAsRead: () => ({ mutate: vi.fn(), isPending: false, isError: false, reset: vi.fn() }),
      useMarkAsRead: () => ({ mutate: vi.fn(), isPending: false, isError: false, reset: vi.fn() }),
    }));
  }

  function fundNotification() {
    return {
      id: 11,
      userId: 3,
      type: 'FUND_NEGATIVE',
      title: 'Quỹ âm',
      message: 'Cả hai quỹ đều âm — cần bổ sung dòng tiền ngay. '
        + 'Quỹ TM -1.500.000 ₫ · Quỹ công ty -2.500.000 ₫',
      relatedEntityType: 'funds',
      relatedEntityId: null,
      isRead: false,
      createdAt: new Date().toISOString(),
    };
  }

  async function openBell() {
    const { NotificationBell: Bell } = await import('./NotificationBell');
    render(<MemoryRouter><Bell /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Thông báo' }));
  }

  it('shows the fund notice with both balances when the fund is negative', async () => {
    vi.resetModules();
    mockFeed([fundNotification()]);
    await openBell();

    expect(screen.getByText('Quỹ âm')).toBeInTheDocument();
    // Both funds are named — a one-sided message would under-report.
    expect(screen.getByText(/Quỹ TM -1\.500\.000 ₫/)).toBeInTheDocument();
    expect(screen.getByText(/Quỹ công ty -2\.500\.000 ₫/)).toBeInTheDocument();
    expect(screen.queryByText('Không có thông báo')).not.toBeInTheDocument();
  });

  it('does NOT show a fund notice when the funds are not negative', async () => {
    vi.resetModules();
    mockFeed([]);
    await openBell();

    expect(screen.queryByText('Quỹ âm')).not.toBeInTheDocument();
    expect(screen.getByText('Không có thông báo')).toBeInTheDocument();
  });
});
