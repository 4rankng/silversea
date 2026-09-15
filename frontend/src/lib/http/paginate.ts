import { api } from '../api';
import { toQuery } from './query';
import type { PaginatedResponse } from '@tingting/shared';

/**
 * Auto-paginate a list endpoint. The backend caps page size at 100; this
 * walks pages with bounded concurrency (default 5) and concatenates items.
 * A single failed page is logged but does not abort the rest.
 *
 * Returns a flat array of items; the `total` count is dropped because
 * callers usually display the full list anyway.
 * `requireComplete` rejects partial results for editable catalogues and totals.
 */
export async function fetchAllPaginated<T>(
  endpoint: string,
  params?: Record<string, string | number | undefined>,
  concurrency = 5,
  options?: { requireComplete?: boolean },
): Promise<T[]> {
  const pageSize = 100;
  const first = await api.get<PaginatedResponse<T>>(
    `${endpoint}${toQuery({ ...params, limit: pageSize, page: 1 })}`,
  );
  const total = first.total ?? 0;
  const effectivePageSize = first.pageSize > 0 ? first.pageSize : pageSize;
  const totalPages = Math.ceil(total / effectivePageSize);
  if (totalPages <= 1) {
    if (options?.requireComplete && (first.items?.length ?? 0) < total) throw new Error('Danh mục chưa tải đầy đủ. Vui lòng thử lại.');
    return first.items ?? [];
  }

  const results: PaginatedResponse<T>[] = [first];
  const pageNums = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
  for (let i = 0; i < pageNums.length; i += concurrency) {
    const batch = pageNums.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map((p) =>
        api.get<PaginatedResponse<T>>(
          `${endpoint}${toQuery({ ...params, limit: pageSize, page: p })}`,
        ),
      ),
    );
    for (const r of batchResults) {
      if (r.status === 'fulfilled') results.push(r.value);
      else if (options?.requireComplete) throw r.reason;
      else console.warn('[fetchAllPaginated] page fetch failed:', r.reason);
    }
  }
  const items = results.flatMap((r) => r.items ?? []);
  if (options?.requireComplete && items.length < total) {
    throw new Error('Danh mục chưa tải đầy đủ. Vui lòng thử lại.');
  }
  return items;
}
