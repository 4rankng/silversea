import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  apiPostMock,
  apiPutMock,
  apiDeleteMock,
  invalidateAllCatalogsMock,
  toastMock,
} = vi.hoisted(() => ({
  apiPostMock: vi.fn(),
  apiPutMock: vi.fn(),
  apiDeleteMock: vi.fn(),
  invalidateAllCatalogsMock: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  api: {
    post: apiPostMock,
    put: apiPutMock,
    delete: apiDeleteMock,
  },
}));

vi.mock('../api/keys', () => ({
  invalidateAllCatalogs: invalidateAllCatalogsMock,
}));

vi.mock('../components/shared/Toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

import { useCRUD } from './useCRUD';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useCRUD success UX', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateAllCatalogsMock.mockResolvedValue(undefined);
  });

  it('shows the direct success toast for updates', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    apiPutMock.mockResolvedValue({
      id: 71,
      name: 'Demo pricing table',
      updatedAt: '2026-07-28T12:00:00.000Z',
    });

    const { result } = renderHook(
      () => useCRUD('/pricing-tables', onRefresh),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.setEditingId(71);
    });

    await act(async () => {
      await result.current.doUpdate(71, { price: 2_100_000 });
    });

    expect(apiPutMock).toHaveBeenCalledWith('/pricing-tables/71', { price: 2_100_000 }, undefined);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(invalidateAllCatalogsMock).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(result.current.editingId).toBeNull();
    });
    expect(toastMock).toHaveBeenCalledWith({
      kind: 'success',
      message: 'Đã cập nhật cấu hình.',
    });
  });

  it('KP-135: forwards caller-bound version token on update', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    apiPutMock.mockResolvedValue({ id: 71, updatedAt: '2026-09-14T10:00:00.000Z' });

    const { result } = renderHook(
      () => useCRUD('/pricing-tables', onRefresh),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      await result.current.doUpdate(71, { price: 3_000_000 }, '2026-09-14T08:00:00.000Z');
    });

    expect(apiPutMock).toHaveBeenCalledWith('/pricing-tables/71', { price: 3_000_000 }, { expectedUpdatedAt: '2026-09-14T08:00:00.000Z' });
  });

  it('keeps the normal success toast for direct creates', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    apiPostMock.mockResolvedValue({
      id: 88,
      name: 'Demo route',
      updatedAt: '2026-07-28T12:00:00.000Z',
    });

    const { result } = renderHook(
      () => useCRUD('/routes', onRefresh),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.setShowAddForm(true);
    });

    await act(async () => {
      await result.current.doCreate({ name: 'Demo route' });
    });

    expect(apiPostMock).toHaveBeenCalledWith('/routes', { name: 'Demo route' });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(invalidateAllCatalogsMock).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(result.current.showAddForm).toBe(false);
    });
    expect(toastMock).toHaveBeenCalledWith({
      kind: 'success',
      message: 'Đã thêm cấu hình.',
    });
  });
});
