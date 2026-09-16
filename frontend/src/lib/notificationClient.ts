import { api } from './api';
import { NOTIFICATIONS } from '@tingting/shared';
import { routes } from './routes';
import type { Notification, PushSubscriptionPayload } from '@tingting/shared';

const isOpsRole = (role: string) => role === 'OPS' || role === 'FORWARDER';

export function resolveNotificationRoute(notification: Notification, role: string): string | null {
  const id = notification.relatedEntityId;
  switch (notification.relatedEntityType) {
    case 'trips':
      if (role === 'DRIVER') return id ? routes.myTripDetail(id) : routes.myTrips;
      if (isOpsRole(role)) return id ? routes.myForwarderTripDetail(id) : routes.myForwarderTrips;
      return id ? routes.tripDetail(id) : routes.trips;
    case 'shipment_fulfillments':
      // The API resolves owned legacy fulfillment references to trip IDs.
      // Cached older responses must not open an unrelated numeric trip ID.
      return role === 'DRIVER' ? routes.myTrips : null;
    case 'advance_settlements':
      if (isOpsRole(role)) return id ? routes.mySettlementDetail(id) : routes.mySettlements;
      return id ? `/settlements/${id}` : '/payables/forwarder-advances';
    case 'shipments':
      return id ? `/dispatch?shipmentId=${id}` : routes.dispatch;
    case 'penalties':
      return role === 'DRIVER' ? routes.myPenalties : routes.penalties;
    case 'payments':
      return role === 'DRIVER' ? routes.myEarnings : routes.finance;
    default:
      return null;
  }
}

export const notificationClient = {
  list: (page = 1, limit = 20) =>
    api.get<{ items: Notification[]; total: number; page: number; limit: number }>(
      `${NOTIFICATIONS.LIST}?page=${page}&limit=${limit}`,
    ),

  getUnreadCount: () =>
    api.get<{ count: number }>(NOTIFICATIONS.UNREAD_COUNT),

  markAsRead: (id: number) =>
    api.post<void>(NOTIFICATIONS.MARK_READ(id), {}),

  markAllAsRead: () =>
    api.post<void>(NOTIFICATIONS.MARK_ALL_READ, {}),

  // ─── Web Push ────────────────────────────────────────────────────────────
  getVapidKey: () =>
    api.get<{ publicKey: string }>(NOTIFICATIONS.VAPID_KEY),

  subscribePush: (payload: PushSubscriptionPayload) =>
    api.post<{ ok: boolean }>(NOTIFICATIONS.SUBSCRIBE, payload),

  unsubscribePush: (endpoint: string) =>
    api.post<{ ok: boolean }>(NOTIFICATIONS.UNSUBSCRIBE, { endpoint }),
};
