import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, BellOff, CheckCheck, Loader2 } from 'lucide-react';
import {
  useInfiniteNotifications,
  useMarkAsRead,
  useMarkAllAsRead,
  useUnreadCount,
} from '../hooks/useNotificationQueries';
import { resolveNotificationRoute } from '../lib/notificationClient';
import { useAuth } from '../hooks/useAuth';
import type { Notification } from '@tingting/shared';
import './NotificationsPage.css';

function timeAgo(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'vừa xong';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} phút trước`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} giờ trước`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days} ngày trước`;
  return d.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
}

export default function NotificationsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: unreadData } = useUnreadCount();
  const markAsRead = useMarkAsRead();
  const markAll = useMarkAllAsRead();

  const {
    data,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
    isFetching,
  } = useInfiniteNotifications(20);

  const allItems = useMemo(
    () => (data?.pages ?? []).flatMap((page) => page.items),
    [data],
  );
  const unread = unreadData?.count ?? 0;

  const handleTap = useCallback(
    (notification: Notification) => {
      if (!notification.isRead) markAsRead.mutate(notification.id);
      const destination = user ? resolveNotificationRoute(notification, user.role) : null;
      if (destination) navigate(destination);
    },
    [markAsRead, navigate, user],
  );

  return (
    <div className="notif-page">
      <header className="notif-page__header">
        <div className="notif-page__title-row">
          <h1 className="notif-page__title">Thông báo</h1>
          {unread > 0 && <span className="notif-page__badge">{unread}</span>}
        </div>
        {unread > 0 && (
          <button
            type="button"
            className="notif-page__markall"
            disabled={markAll.isPending}
            onClick={() => markAll.mutate()}
          >
            <CheckCheck size={16} />
            <span>Đọc tất cả</span>
          </button>
        )}
      </header>

      <div className="notif-page__list">
        {isLoading ? (
          <div className="notif-page__state">
            <Loader2 size={20} className="spin" />
            <p>Đang tải thông báo…</p>
          </div>
        ) : error ? (
          <div className="notif-page__state notif-page__state--error">
            <BellOff size={28} />
            <p>Không thể tải thông báo.</p>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              Thử lại
            </button>
          </div>
        ) : allItems.length === 0 ? (
          <div className="notif-page__state">
            <Bell size={28} />
            <p>Chưa có thông báo nào.</p>
          </div>
        ) : (
          <>
            {allItems.map((notification) => (
              <button
                key={notification.id}
                type="button"
                className={`notif-page__item${notification.isRead ? '' : ' is-unread'}`}
                onClick={() => handleTap(notification)}
              >
                <span className="notif-page__dot" aria-hidden="true" />
                <div className="notif-page__item-body">
                  <div className="notif-page__item-title">{notification.title}</div>
                  {notification.message && (
                    <div className="notif-page__item-msg">{notification.message}</div>
                  )}
                  <div className="notif-page__item-time">{timeAgo(notification.createdAt)}</div>
                </div>
              </button>
            ))}

            {hasNextPage && (
              <button
                type="button"
                className="notif-page__loadmore"
                disabled={isFetchingNextPage}
                onClick={() => fetchNextPage()}
              >
                {isFetchingNextPage ? (
                  <Loader2 size={16} className="spin" />
                ) : (
                  'Tải thêm'
                )}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
