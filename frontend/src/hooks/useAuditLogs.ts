import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { qk } from '../api/keys';

export interface AuditEntry {
  id: number;
  timestamp: string;
  userEmail?: string;
  userName?: string;
  action: string;
  method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'GET';
  path?: string;
  message: string;
  category?: 'trip' | 'config' | 'finance' | 'auth' | 'penalty';
  payload?: Record<string, unknown>;
  ipAddress?: string;
}

export type Category = 'all' | 'trip' | 'config' | 'finance' | 'auth' | 'penalty';

export function useAuditLogs(pageSize: number, filter: Category, search: string) {
  return useInfiniteQuery<{ items: AuditEntry[]; total: number }>({
    queryKey: qk.auditLogs.list(pageSize, filter, search),
    queryFn: async ({ pageParam = 1 }) => {
      const params = new URLSearchParams({ page: String(pageParam), limit: String(pageSize) });
      if (filter !== 'all') params.set('category', filter);
      if (search.trim()) params.set('search', search.trim());
      return api.get<{ items: AuditEntry[]; total: number }>(`/audit-logs?${params}`);
    },
    getNextPageParam: (lastPage, allPages) => {
      const loadedItems = allPages.reduce((sum, page) => sum + page.items.length, 0);
      return loadedItems < lastPage.total ? allPages.length + 1 : undefined;
    },
    initialPageParam: 1,
  });
}
