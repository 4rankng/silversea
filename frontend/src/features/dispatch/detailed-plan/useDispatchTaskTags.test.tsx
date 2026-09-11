import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listDispatchTaskTags } from '../../../api/dispatchPlanningClient';
import { useDispatchTaskTags } from './useDispatchTaskTags';

vi.mock('../../../api/dispatchPlanningClient', () => ({
  listDispatchTaskTags: vi.fn(),
  createDispatchTaskTag: vi.fn(),
  updateDispatchTaskTag: vi.fn(),
  deactivateDispatchTaskTag: vi.fn(),
}));

const listMock = vi.mocked(listDispatchTaskTags);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useDispatchTaskTags', () => {
  beforeEach(() => {
    listMock.mockReset();
  });

  it('returns tags in API-provided order (server sorts by displayOrder)', async () => {
    // API returns already-sorted results: displayOrder ASC NULLS LAST, label ASC
    listMock.mockResolvedValue({
      items: [
        { id: 2, label: 'ĐẢO VỎ', displayOrder: 2 },
        { id: 3, label: 'ĐẶT ĐUÔI', displayOrder: 3 },
        { id: 1, label: 'ĐẶT ĐẦU', displayOrder: 1 },
        { id: 4, label: 'KIỂM HÓA', displayOrder: 4 },
      ],
    });
    const { result } = renderHook(() => useDispatchTaskTags(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.tags.map((tag) => tag.label)).toEqual([
      'ĐẢO VỎ',
      'ĐẶT ĐUÔI',
      'ĐẶT ĐẦU',
      'KIỂM HÓA',
    ]);
  });

  it('passes through API order for mixed canonical and custom tags', async () => {
    // Server returns canonical tags first (by displayOrder), then custom tags
    listMock.mockResolvedValue({
      items: [
        { id: 22, label: 'HẾT HẠN', displayOrder: 1 },
        { id: 1, label: 'ĐẶT ĐẦU', displayOrder: 3 },
        { id: 21, label: 'KIỂM ĐẾM', displayOrder: null },
        { id: 20, label: 'XẾP VỎ', displayOrder: null },
      ],
    });
    const { result } = renderHook(() => useDispatchTaskTags(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.tags.map((tag) => tag.label)).toEqual([
      'HẾT HẠN',
      'ĐẶT ĐẦU',
      'KIỂM ĐẾM',
      'XẾP VỎ',
    ]);
  });
});
