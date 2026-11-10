import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { postMock, useTripDetailMock, useAuthMock } = vi.hoisted(() => ({
  postMock: vi.fn(),
  useTripDetailMock: vi.fn(),
  useAuthMock: vi.fn(),
}));

vi.mock('../../lib/api', () => ({
  api: { post: postMock, get: vi.fn() },
  ApiError: class extends Error { status: number; constructor(status: number, raw: unknown, message: string) { super(message); this.status = status; } },
}));
vi.mock('../../hooks/useQueries', () => ({
  useTripDetail: useTripDetailMock,
  useTripAdjustments: vi.fn().mockReturnValue({ data: { items: [] } }),
  useTrucksAndDrivers: vi.fn().mockReturnValue({ data: null }),
  useFuelConfig: vi.fn().mockReturnValue({ data: null }),
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: useAuthMock }));
vi.mock('../../hooks/useCatalogs', () => ({ useCatalogs: () => ({ data: { trucks: [], drivers: [], customers: [], externalCarriers: [], routes: [] } }) }));
vi.mock('../../components/UI', () => ({ useConfirm: () => ({ confirm: vi.fn(async () => true), dialog: null }) }));

import { useTripDetailPage } from './useTripDetailPage';
import { ApiError } from '../../lib/api';

const refetchMock = vi.fn().mockResolvedValue(undefined);

function renderPage(id = '492') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { result } = renderHook(() => useTripDetailPage(id), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  return result;
}

function tripWith(podRecoveredAt: string | null) {
  return {
    id: 492,
    version: 11,
    status: 'IN_TRANSIT',
    podRecoveredAt,
  };
}

beforeEach(() => {
  postMock.mockReset();
  refetchMock.mockClear();
  useAuthMock.mockReturnValue({ user: { userId: 9, role: 'ACCOUNTANT' } });
  useTripDetailMock.mockReturnValue({
    data: tripWith(null),
    isLoading: false,
    error: null,
    refetch: refetchMock,
  });
});

// SIL-694 — the POD-gốc recovery flow: the governed close 409s on the
// "Chưa thu hồi POD gốc" gate while trip.podRecoveredAt is null and no UI
// path could mark it. The mark rides the backend's ACCOUNTANT/CUS allowlist
// (routes/trips/pod.ts), optimistic-locked with the loaded trip's version.
describe('useTripDetailPage — SIL-694 POD-gốc mark', () => {
  it('offers the mark to ACCOUNTANT on an unmarked IN_TRANSIT trip and posts the optimistic lock', async () => {
    postMock.mockResolvedValueOnce({});
    const result = renderPage();
    expect(result.current.permissions.canMarkPodRecovered).toBe(true);
    await act(async () => { await result.current.handleMarkPodRecovered(); });
    expect(postMock).toHaveBeenCalledTimes(1);
    const [url, body] = postMock.mock.calls[0]!;
    expect(url).toBe('/trips/492/pod-recovered');
    expect(body).toEqual({ expectedVersion: 11 });
    expect(refetchMock).toHaveBeenCalled();
  });

  it('never offers the mark to ADMIN/MANAGER — the server 403s them', () => {
    useAuthMock.mockReturnValue({ user: { userId: 1, role: 'ADMIN' } });
    const result = renderPage();
    expect(result.current.permissions.canMarkPodRecovered).toBe(false);
  });

  it('the mark disappears once the POD is recorded', () => {
    useTripDetailMock.mockReturnValue({
      data: tripWith('2026-11-09T03:00:00.000Z'),
      isLoading: false,
      error: null,
      refetch: refetchMock,
    });
    const result = renderPage();
    expect(result.current.permissions.canMarkPodRecovered).toBe(false);
    expect(result.current.trip?.podRecoveredAt).toBe('2026-11-09T03:00:00.000Z');
  });

  it('surfaces the API error message instead of a generic failure', async () => {
    postMock.mockRejectedValueOnce(new ApiError(409, { message: 'Chuyến đi đã bị thay đổi. Vui lòng tải lại.' }, 'Chuyến đi đã bị thay đổi. Vui lòng tải lại.'));
    const result = renderPage();
    await act(async () => { await result.current.handleMarkPodRecovered(); });
    expect(result.current.ui.actionError).toBe('Chuyến đi đã bị thay đổi. Vui lòng tải lại.');
  });
});
