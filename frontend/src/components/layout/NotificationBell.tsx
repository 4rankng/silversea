import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, BadgeCheck, Bell, BellOff, BellRing, CalendarClock,
  CircleDollarSign, CircleX, Megaphone, PackageCheck, Truck, Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useClickOutside } from '../../hooks/useClickOutside';
import { usePopoverDialog } from '../../hooks/usePopoverDialog';
import { useUnreadCount, useNotifications, useMarkAllAsRead, useMarkAsRead } from '../../hooks/useNotificationQueries';
import { usePushNotifications } from '../../hooks/usePushNotifications';
import { useAuth } from '../../hooks/useAuth';
import type { Notification } from '@tingting/shared';
import { resolveNotificationRoute } from '../../lib/notificationClient';
import { notificationDisplayMessage } from '../../lib/notificationText';
// Card 2026-10-05_1628: this bell had its own near-duplicate relative-time
// helper, so its wording drifted from the rest of the app (no "Hôm qua", and a
// full locale date once past 30 days). Use the one shared formatter so a
// timestamp reads the same everywhere and stays unambiguous (compact DD/MM
// rather than a long date).
import { formatRelativeTime } from '../../lib/date';
import { routes } from '../../lib/routes';

/**
 * Per-type icon + tint for the row avatar. Semantic tones reuse the app-wide
 * soft/status token pairs (--accent-soft/--accent, --info, --warning,
 * --danger) — the same mapping InfoRow and the KPI tiles use. Unknown types
 * fall back to the neutral bell so a new backend type renders, never crashes.
 */
type NotifTone = 'accent' | 'info' | 'warning' | 'danger' | 'neutral';
const TYPE_VISUALS: Record<string, { icon: LucideIcon; tone: NotifTone }> = {
  TRIP_CREATED: { icon: Truck, tone: 'accent' },
  TRIP_DISPATCHED: { icon: Truck, tone: 'accent' },
  TRIP_IN_TRANSIT: { icon: Truck, tone: 'accent' },
  TRIP_COMPLETED: { icon: Truck, tone: 'accent' },
  TRIP_CANCELED: { icon: CircleX, tone: 'danger' },
  PAYMENT_RECEIVED: { icon: CircleDollarSign, tone: 'accent' },
  OVERDUE_PAYMENT: { icon: CircleDollarSign, tone: 'danger' },
  PENALTY_CREATED: { icon: AlertTriangle, tone: 'warning' },
  PENALTY_CANCELED: { icon: AlertTriangle, tone: 'neutral' },
  SALARY_PERIOD_CLOSING: { icon: CalendarClock, tone: 'info' },
  SYSTEM_ANNOUNCEMENT: { icon: Megaphone, tone: 'info' },
  ADVANCE_SETTLEMENT_APPROVED: { icon: BadgeCheck, tone: 'accent' },
  SHIPMENT_HANDOFF: { icon: PackageCheck, tone: 'info' },
  FUND_NEGATIVE: { icon: Wallet, tone: 'danger' },
};
const FALLBACK_VISUAL: { icon: LucideIcon; tone: NotifTone } = { icon: Bell, tone: 'neutral' };

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
  // Modal dialog semantics (SIL-561) — same primitive family as the filter
  // and column popovers: aria-modal, focus into the panel, inert background,
  // focus return on every close path.
  const panelRef = useRef<HTMLDivElement>(null);
  const panelTriggerRef = useRef<HTMLButtonElement>(null);
  usePopoverDialog(panelRef, panelTriggerRef, open);

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

  // The full-list page (/notifications) is driver-only (App.tsx), so the
  // "Xem tất cả" exit is offered only where the route actually resolves.
  const isDriver = user?.role === 'DRIVER';

  return (
    <div className="notif-bell" ref={containerRef}>
      <button
        type="button"
        ref={panelTriggerRef}
        className="icon-btn notif-bell__btn"
        aria-label="Thông báo"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
      >
        <Bell size={20} strokeWidth={1.8} aria-hidden="true" />
        {unread > 0 && <span className="badge">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <div className="notif-panel" role="dialog" aria-label="Thông báo" ref={panelRef}>
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
              items.map(n => {
                const visual = TYPE_VISUALS[n.type] ?? FALLBACK_VISUAL;
                const Icon = visual.icon;
                return (
                  <button
                    type="button"
                    key={n.id}
                    className={`notif-item ${n.isRead ? 'is-read' : 'is-unread'}`}
                    onClick={() => openNotification(n)}
                  >
                    <span className={`notif-item__avatar notif-item__avatar--${visual.tone}`} aria-hidden="true">
                      <Icon size={16} strokeWidth={1.8} />
                      {!n.isRead && <span className="notif-item__dot" />}
                    </span>
                    <div className="notif-item__body">
                      <div className="notif-item__top">
                        <span className="notif-item__title">{n.title}</span>
                        <time
                          className="notif-item__time"
                          dateTime={n.createdAt}
                          title={new Date(n.createdAt).toLocaleString('vi-VN')}
                        >
                          {formatRelativeTime(n.createdAt)}
                        </time>
                      </div>
                      {n.message && <div className="notif-item__msg">{notificationDisplayMessage(n.message)}</div>}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {(push.isSupported || isDriver) && (
            <div className="notif-panel__foot">
              {push.isSupported && (
                <button
                  type="button"
                  className="notif-panel__push"
                  disabled={push.isLoading}
                  onClick={() => { void (push.isSubscribed ? push.unsubscribe() : push.subscribe()); }}
                >
                  {push.isSubscribed ? <BellOff size={15} strokeWidth={1.8} aria-hidden="true" /> : <BellRing size={15} strokeWidth={1.8} aria-hidden="true" />}
                  {push.isSubscribed ? 'Tắt thông báo đẩy' : 'Bật thông báo đẩy'}
                </button>
              )}
              {isDriver && (
                <button
                  type="button"
                  className="notif-panel__viewall"
                  onClick={() => { setOpen(false); navigate(routes.myNotifications); }}
                >
                  Xem tất cả
                </button>
              )}
              {push.errorMessage && <div className="notif-panel__push-err">{push.errorMessage}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
