import { api } from './api';
import { NOTIFICATIONS } from '@tingting/shared';
import type { Notification, PushSubscriptionPayload } from '@tingting/shared';

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
