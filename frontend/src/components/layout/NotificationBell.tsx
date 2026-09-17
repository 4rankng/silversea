import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { useClickOutside } from '../../hooks/useClickOutside';
import { useUnreadCount, useNotifications, useMarkAllAsRead, useMarkAsRead } from '../../hooks/useNotificationQueries';
import { usePushNotifications } from '../../hooks/usePushNotifications';
import { useAuth } from '../../hooks/useAuth';
import type { Notification } from '@tingting/shared';
import { resolveNotificationRoute } from '../../lib/notificationClient';

/** Relative time in Vietnamese, e.g. "5 phút trước". */
function timeAgo(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
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

/**
 * Topbar notification bell — the entry point for in-app + push notifications.
 * Replaces the dead "?" help button. Shows an unread badge, a dropdown of recent
 * notifications, mark-all-read, and (where supported) a Web Push opt-in toggle.
 */
export function NotificationBell() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: unreadData } = useUnreadCount();
  const { data, isLoading, isError, isFetching, refetch } = useNotifications(1, 20);
  const markAll = useMarkAllAsRead();
  const markAsRead = useMarkAsRead();
  const push = usePushNotifications();

  const unread = unreadData?.count ?? 0;
  const items = data?.items ?? [];

  useClickOutside(containerRef, () => setOpen(false), { escapeKey: true, enabled: open });

  const openNotification = (notification: Notification) => {
    if (!notification.isRead) {
      markAll.reset();
      markAsRead.mutate(notification.id);
    }
    const destination = user ? resolveNotificationRoute(notification, user.role) : null;
    if (destination) {
      setOpen(false);
      navigate(destination);
    }
  };

  return (
    <div className="notif-bell" ref={containerRef}>
      <button
        type="button"
        className="icon-btn notif-bell__btn"
        aria-label="Thông báo"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
      >
        <Bell size={20} strokeWidth={1.8} aria-hidden="true" />
        {unread > 0 && <span className="badge">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <div className="notif-panel" role="dialog" aria-label="Thông báo">
          <div className="notif-panel__head">
            <span>Thông báo{unread > 0 ? ` (${unread})` : ''}</span>
            {unread > 0 && (
              <button
                type="button"
                className="notif-panel__markall"
                disabled={markAll.isPending}
                onClick={() => { markAsRead.reset(); markAll.mutate(); }}
              >
                Đánh dấu đã đọc
              </button>
            )}
          </div>

          <div className="notif-panel__list">
            {(markAll.isError || markAsRead.isError) && (
              <div className="notif-panel__empty" role="alert">
                Không thể đánh dấu đã đọc. Vui lòng thử lại.
              </div>
            )}
            {isError && <div className="notif-panel__empty" role="alert">
              <p>Không tải được thông báo. Vui lòng thử lại.</p>
              <button type="button" className="btn btn--secondary btn--sm" disabled={isFetching} onClick={() => { void refetch(); }}>{isFetching ? 'Đang thử lại…' : 'Thử lại'}</button>
            </div>}
            {isLoading ? (
              <div className="notif-panel__empty">Đang tải…</div>
            ) : items.length === 0 ? (
              !isError && <div className="notif-panel__empty">Không có thông báo</div>
            ) : (
              items.map(n => (
                <button
                  type="button"
                  key={n.id}
                  className={`notif-item ${n.isRead ? '' : 'is-unread'}`}
                  onClick={() => openNotification(n)}
                >
                  <span className="notif-item__dot" aria-hidden="true" />
                  <div className="notif-item__body">
                    <div className="notif-item__title">{n.title}</div>
                    {n.message && <div className="notif-item__msg">{n.message}</div>}
                    <div className="notif-item__time">{timeAgo(n.createdAt)}</div>
                  </div>
                </button>
              ))
            )}
          </div>

          {push.isSupported && (
            <div className="notif-panel__foot">
              <button
                type="button"
                className="notif-panel__push"
                disabled={push.isLoading}
                onClick={() => { void (push.isSubscribed ? push.unsubscribe() : push.subscribe()); }}
              >
                {push.isSubscribed ? '🔔 Tắt thông báo đẩy' : '🔔 Bật thông báo đẩy trên thiết bị này'}
              </button>
              {push.errorMessage && <div className="notif-panel__push-err">{push.errorMessage}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
