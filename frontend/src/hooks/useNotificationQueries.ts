import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationClient } from '../lib/notificationClient';
import { qk } from '../api/keys';
import type { Notification } from '@tingting/shared';

interface NotificationPage {
  items: Notification[];
  total: number;
  page: number;
  limit: number;
}

export function useUnreadCount(options?: { enabled?: boolean }) {
  return useQuery<{ count: number }>({
    queryKey: qk.notifications.unreadCount,
    queryFn: () => notificationClient.getUnreadCount(),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    enabled: options?.enabled ?? true,
  });
}

export function useNotifications(page = 1, limit = 20) {
  return useQuery<NotificationPage>({
    queryKey: qk.notifications.list(page, limit),
    queryFn: () => notificationClient.list(page, limit),
    staleTime: 30_000,
  });
}

export function useInfiniteNotifications(limit = 20, options?: { enabled?: boolean }) {
  return useInfiniteQuery<NotificationPage>({
    queryKey: qk.notifications.infiniteList(limit),
    queryFn: ({ pageParam }) => notificationClient.list(Number(pageParam), limit),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const loaded = lastPage.page * lastPage.limit;
      return loaded < lastPage.total ? lastPage.page + 1 : undefined;
    },
    staleTime: 30_000,
    enabled: options?.enabled ?? true,
  });
}

export function useMarkAsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => notificationClient.markAsRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.notifications.all });
    },
  });
}

export function useMarkAllAsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => notificationClient.markAllAsRead(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.notifications.all });
    },
  });
}
