import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { postMock, useTripDetailMock, useTripAdjustmentsMock, useTrucksAndDriversMock, useFuelConfigMock, toastMock } = vi.hoisted(() => ({
  postMock: vi.fn(),
  useTripDetailMock: vi.fn(),
  useTripAdjustmentsMock: vi.fn(),
  useTrucksAndDriversMock: vi.fn(),
  useFuelConfigMock: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock('../../lib/api', () => ({
  api: { post: postMock, get: vi.fn() },
  ApiError: class extends Error { status: number; constructor(status: number, raw: unknown, message: string) { super(message); this.status = status; } },
}));
vi.mock('../../hooks/useQueries', () => ({
  useTripDetail: useTripDetailMock,
  useTripAdjustments: useTripAdjustmentsMock,
  useTrucksAndDrivers: useTrucksAndDriversMock,
  useFuelConfig: useFuelConfigMock,
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { userId: 1, role: 'MANAGER' } }) }));
vi.mock('../../hooks/useCatalogs', () => ({ useCatalogs: () => ({ data: { trucks: [], drivers: [], customers: [], routes: [] } }) }));
vi.mock('../../components/UI', () => ({ useConfirm: () => ({ confirm: vi.fn(async () => true), dialog: null }) }));
vi.mock('../../components/shared/Toast', () => ({ useToast: () => ({ toast: toastMock }) }));

import { useTripDetailPage } from './useTripDetailPage';

const refetchMock = vi.fn().mockResolvedValue(undefined);

function renderPage(id = '19') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { result } = renderHook(() => useTripDetailPage(id), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  return result;
}

beforeEach(() => {
  postMock.mockReset();
  refetchMock.mockClear();
  useTripDetailMock.mockReturnValue({
    data: { id: 19, version: 7, status: 'COMPLETED' },
    isLoading: false,
    error: null,
    refetch: refetchMock,
  });
  useTripAdjustmentsMock.mockReturnValue({ data: { items: [] } });
  useTrucksAndDriversMock.mockReturnValue({ data: null });
  useFuelConfigMock.mockReturnValue({ data: null });
});

// Publishing an AR adjustment rides the trip's current version plus an
// idempotency key; a stale version surfaces recovery guidance with a refetch
// and preserved inputs.
describe('handleAdjustSubmit publish wiring', () => {
  it('sends expectedVersion from the loaded trip and an Idempotency-Key header', async () => {
    postMock.mockResolvedValueOnce({});
    const result = renderPage();
    act(() => {
      result.current.ui.adjustAmount = '2000000';
      result.current.ui.adjustNote = 'QA reason';
      result.current.ui.adjustRef = 'QA-BB-0914-001';
    });
    // The ui state is read-only projections — drive via the setters.
    act(() => result.current.setAdjustAmount('2000000'));
    act(() => result.current.setAdjustNote('QA reason'));
    act(() => result.current.setAdjustRef('QA-BB-0914-001'));
    await act(async () => { await result.current.handleAdjustSubmit(); });
    expect(postMock).toHaveBeenCalledTimes(1);
    const [url, body, options] = postMock.mock.calls[0]!;
    expect(url).toBe('/trips/19/adjustment');
    expect(body.expectedVersion).toBe(7);
    expect(options.headers['Idempotency-Key']).toMatch(/.+/);
  });

  it('maps a stale-version 409 to recovery guidance, refetches, and keeps inputs', async () => {
    postMock.mockRejectedValueOnce(Object.assign(new Error('Chuyến đi đã được thay đổi'), { status: 409 }));
    const result = renderPage();
    act(() => result.current.setAdjustAmount('2000000'));
    act(() => result.current.setAdjustNote('QA reason'));
    act(() => result.current.setAdjustRef('QA-BB-0914-001'));
    await act(async () => { await result.current.handleAdjustSubmit(); });
    expect(result.current.ui.adjustError).toContain('kiểm tra lại thông tin rồi phát hành lại');
    expect(refetchMock).toHaveBeenCalled();
    expect(result.current.ui.adjustAmount).toBe('2000000');
    expect(result.current.ui.adjustNote).toBe('QA reason');
  });

  it('never fires without a finite version', async () => {
    useTripDetailMock.mockReturnValue({ data: undefined, isLoading: true, error: null, refetch: refetchMock });
    const result = renderPage();
    act(() => result.current.setAdjustAmount('1'));
    act(() => result.current.setAdjustNote('x'));
    act(() => result.current.setAdjustRef('y'));
    await act(async () => { await result.current.handleAdjustSubmit(); });
    expect(postMock).not.toHaveBeenCalled();
  });
});

describe('adjustment input safety', () => {
  it.each(['NaN', 'Infinity', '1.5', '0', '9007199254740992'])('preserves invalid amount %s without writing', async (amount) => {
    const result = renderPage();
    act(() => {
      result.current.setAdjustAmount(amount);
      result.current.setAdjustNote('Reason');
      result.current.setAdjustRef('AGREEMENT-1');
    });
    await act(async () => { await result.current.handleAdjustSubmit(); });
    expect(postMock).not.toHaveBeenCalled();
    expect(result.current.ui.adjustAmount).toBe(amount);
    expect(result.current.ui.adjustError).toContain('nguyên đồng');
  });

  it('prevents two rapid clicks from publishing the same adjustment twice', async () => {
    let finish!: () => void;
    postMock.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
    const result = renderPage();
    act(() => {
      result.current.setAdjustAmount('-100000');
      result.current.setAdjustNote('Reduction');
      result.current.setAdjustRef('AGREEMENT-2');
    });
    await act(async () => {
      const first = result.current.handleAdjustSubmit();
      await result.current.handleAdjustSubmit();
      expect(postMock).toHaveBeenCalledTimes(1);
      finish();
      await first;
    });
    expect(postMock.mock.calls[0][1].amount).toBe(-100000);
  });
});
