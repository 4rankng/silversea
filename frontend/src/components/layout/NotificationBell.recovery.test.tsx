import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { NotificationBell } from './NotificationBell';

const { refetch } = vi.hoisted(() => ({ refetch: vi.fn() }));
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
